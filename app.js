/* ====== CONFIG: fill these in ====== */
const GOOGLE_CLIENT_ID = "YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com";
const GOOGLE_API_KEY   = "YOUR_PUBLIC_API_KEY";
/* Optional: create/use this folder in Drive (will be auto-created if missing) */
const DRIVE_FOLDER_NAME = "ShopPhotos";
/* =================================== */

let gapiInited = false;
let gisInited = false;
let tokenClient = null;
let accessToken = null;
let driveFolderId = null;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/* UI helpers */
function toast(msg){ const t=$("#toast"); t.textContent=msg; t.classList.add("show"); setTimeout(()=>t.classList.remove("show"),2600); }
function setBtnLoading(btn, loading){
  btn.classList.toggle("loading", !!loading);
  btn.disabled = !!loading;
}

/* ---- PWA install prompt ---- */
let deferredPrompt;
const installBtn = $("#installBtn");
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.hidden = false;
});
installBtn?.addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  installBtn.hidden = true;
  deferredPrompt = null;
});

/* ---- Geolocation (auto on open) ---- */
async function getLocation(){
  if (!('geolocation' in navigator)) {
    $("#locBadge").textContent = "Geolocation not supported";
    return;
  }
  $("#locBadge").textContent = "Locating…";
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        $("#lat").value = latitude.toFixed(6);
        $("#lng").value = longitude.toFixed(6);
        $("#locBadge").textContent = `📍 ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
        resolve(true);
      },
      (err) => {
        console.warn(err);
        $("#locBadge").textContent = "Location denied";
        resolve(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });
}

window.addEventListener("load", getLocation);
$("#refreshLoc").addEventListener("click", getLocation);

/* ---- Stars rating ---- */
(function initStars(){
  const starEls = $$("#stars .star");
  starEls.forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const val = Number(btn.dataset.value);
      $("#rating").value = val;
      starEls.forEach(b=>{
        const active = Number(b.dataset.value) <= val;
        b.classList.toggle("active", active);
        b.setAttribute("aria-checked", String(active && Number(b.dataset.value)===val));
      });
    });
  });
})();

/* ---- Photo preview (and store the chosen File) ---- */
let selectedFile = null;
$("#photo").addEventListener("change", async (e)=>{
  const file = e.target.files?.[0];
  selectedFile = file || null;
  const preview = $("#photoPreview");
  preview.innerHTML = "";
  if (!file) return;
  const url = URL.createObjectURL(file);
  const div = document.createElement("div");
  div.className = "thumb";
  div.innerHTML = `<img src="${url}" alt="Selected photo"><span class="badge">Selected</span>`;
  preview.appendChild(div);
});

/* ---- Offline cache of entries (LocalStorage) ---- */
const LS_KEY = "shoplogger_offline_entries";
function readOffline(){
  try{ return JSON.parse(localStorage.getItem(LS_KEY)||"[]"); }catch{ return []; }
}
function writeOffline(arr){
  localStorage.setItem(LS_KEY, JSON.stringify(arr));
  renderOffline();
}
function renderOffline(){
  const list = $("#offlineList");
  const items = readOffline();
  list.innerHTML = "";
  items.forEach((it, idx)=>{
    const div = document.createElement("div");
    div.className = "thumb";
    div.innerHTML = `
      <img src="${it.photoDataUrl}" alt="${it.shopName}">
      <span class="badge">${it.shopName} • ${it.rating}★</span>
    `;
    list.appendChild(div);
  });
}
renderOffline();

/* Save offline only (photo -> dataURL for storage) */
$("#saveLocalBtn").addEventListener("click", async ()=>{
  const shopName = $("#shopName").value.trim();
  if(!shopName){ toast("Shop Name is required to save offline."); return; }
  if(!selectedFile){ toast("Please add a photo."); return; }

  const rating = Number($("#rating").value||0);
  const remark = $("#remark").value||"";
  const lat = $("#lat").value||null;
  const lng = $("#lng").value||null;

  const photoDataUrl = await fileToDataURL(selectedFile);
  const items = readOffline();
  items.push({shopName, rating, remark, lat, lng, photoDataUrl, ts: Date.now()});
  writeOffline(items);
  toast("Saved offline.");
});

/* ---- Google API init ---- */
window.addEventListener("load", () => {
  // The external scripts load async; poll until available, then init.
  const ready = setInterval(()=>{
    if (window.gapi && window.google && !gapiInited) {
      clearInterval(ready);
      initGoogle();
    }
  }, 200);
});

async function initGoogle(){
  // 1) Init Identity token client
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: "https://www.googleapis.com/auth/drive.file",
    callback: (t) => { accessToken = t.access_token; },
  });
  gisInited = true;

  // 2) Init gapi client
  gapi.load("client", async () => {
    await gapi.client.init({
      apiKey: GOOGLE_API_KEY,
      discoveryDocs: ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"],
    });
    gapiInited = true;
    // Optional: lazy ensure folder id after auth on first upload
  });
}

/* Get access token (pop up consent if needed) */
async function ensureAccessToken(){
  return new Promise((resolve, reject)=>{
    if (!gisInited) return reject(new Error("Google Identity not ready"));
    tokenClient.callback = (t) => {
      accessToken = t.access_token;
      resolve(accessToken);
    };
    // prompt if no token; otherwise get a fresh token silently
    const shouldPrompt = !accessToken;
    tokenClient.requestAccessToken({ prompt: shouldPrompt ? "consent" : "" });
  });
}

/* Ensure Drive folder exists (name -> id) */
async function ensureDriveFolderId(){
  if (driveFolderId) return driveFolderId;
  // search
  const q = `mimeType='application/vnd.google-apps.folder' and name='${DRIVE_FOLDER_NAME}' and trashed=false`;
  const res = await gapi.client.drive.files.list({ q, fields: "files(id,name)" });
  if (res.result.files && res.result.files.length){
    driveFolderId = res.result.files[0].id;
    return driveFolderId;
  }
  // create
  const create = await gapi.client.drive.files.create({
    resource: { name: DRIVE_FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" },
    fields: "id,name",
  });
  driveFolderId = create.result.id;
  return driveFolderId;
}

/* Convert file to dataURL */
function fileToDataURL(file){
  return new Promise((resolve,reject)=>{
    const r=new FileReader();
    r.onload=()=>resolve(r.result);
    r.onerror=reject;
    r.readAsDataURL(file);
  });
}

/* Build a new File with a new name */
async function renameFile(file, newName){
  const blob = await file.arrayBuffer();
  const type = file.type || "image/jpeg";
  return new File([blob], newName, { type });
}

/* Multipart upload to Drive using fetch (with token) */
async function uploadToDrive(file, filename, metadata = {}){
  const boundary = "-------ShopLoggerFormBoundary" + Math.random().toString(16).slice(2);
  const meta = {
    name: filename,
    mimeType: file.type || "image/jpeg",
    ...metadata,
  };
  const formBody = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(meta),
    `--${boundary}`,
    `Content-Type: ${file.type || "image/jpeg"}`,
    "",
    new Uint8Array(await file.arrayBuffer()),
    `--${boundary}--`,
    ""
  ];

  // Build body as Blob to mix strings + binary
  const bodyParts = formBody.map(part => (typeof part==="string" ? new TextEncoder().encode(part+"\r\n") : part));
  const totalLength = bodyParts.reduce((s,p)=>s+p.length,0);
  const uint = new Uint8Array(totalLength);
  let offset=0;
  for (const p of bodyParts){ uint.set(p, offset); offset += p.length; }

  const resp = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,webContentLink", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body: uint
  });
  if (!resp.ok){
    const errTxt = await resp.text();
    throw new Error("Drive upload failed: " + errTxt);
  }
  return resp.json();
}

/* ---- Form submit: rename to ShopName + upload ---- */
$("#shopForm").addEventListener("submit", async (e)=>{
  e.preventDefault();
  const btn = $("#saveBtn");
  setBtnLoading(btn, true);

  try{
    const shopName = $("#shopName").value.trim();
    const rating = Number($("#rating").value || 0);
    const remark = $("#remark").value || "";
    const lat = $("#lat").value || null;
    const lng = $("#lng").value || null;

    if (!shopName){ toast("Please enter Shop Name."); setBtnLoading(btn,false); return; }
    if (!selectedFile){ toast("Please attach a photo."); setBtnLoading(btn,false); return; }

    // 1) Auth + Drive folder
    await ensureAccessToken();
    await ensureDriveFolderId();

    // 2) Rename photo to Shop Name
    const ext = (selectedFile.name.split(".").pop() || "jpg").toLowerCase();
    const safeName = shopName.replace(/[\\/:*?"<>|]+/g,"_").trim();
    const filename = `${safeName}.${ext}`;
    const renamed = await renameFile(selectedFile, filename);

    // 3) Upload
    const meta = { parents: [driveFolderId] };
    const uploaded = await uploadToDrive(renamed, filename, meta);

    // 4) Optionally, create a simple JSON note alongside the photo (comment out if not needed)
    const details = {
      shopName, rating, remark, lat, lng, uploadedFileId: uploaded.id, uploadedFileName: uploaded.name, ts: new Date().toISOString()
    };
    const detailsBlob = new Blob([JSON.stringify(details,null,2)], { type: "application/json" });
    await uploadToDrive(new File([await detailsBlob.arrayBuffer()], `${safeName}.json`, { type: "application/json" }), `${safeName}.json`, { parents: [driveFolderId] });

    toast("Uploaded to Google Drive ✅");
  }catch(err){
    console.error(err);
    toast("Upload failed — saved offline.");
    // Save offline on failure
    if (selectedFile){
      const photoDataUrl = await fileToDataURL(selectedFile);
      const entry = {
        shopName: $("#shopName").value.trim(),
        rating: Number($("#rating").value||0),
        remark: $("#remark").value||"",
        lat: $("#lat").value||null,
        lng: $("#lng").value||null,
        photoDataUrl,
        ts: Date.now()
      };
      const arr = readOffline(); arr.push(entry); writeOffline(arr);
    }
  }finally{
    setBtnLoading(btn, false);
  }
});
