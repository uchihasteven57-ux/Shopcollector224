/* ========= CONFIG =========
 * GAS_WEB_APP_URL: your Apps Script Web App URL (same endpoint handles both photo & entry)
 * ========================= */
const GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbzPM_Q1Upf4w2YjElrhqA7_0Ts4KWpl3apKTdDHQG7fxcTxiSRp9rCycDS4h53iR5kR/exec";

/* Utilities */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

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

/* ---- Photo preview ---- */
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

/* ---- Local offline cache ---- */
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
  items.forEach((it)=>{
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

async function fileToDataURL(file){
  return new Promise((resolve,reject)=>{
    const r=new FileReader();
    r.onload=()=>resolve(r.result);
    r.onerror=reject;
    r.readAsDataURL(file);
  });
}
function dataUrlToBase64(dataUrl){
  return dataUrl.split(",")[1] || "";
}

/* Save offline only */
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

/* ---- Submit (Sheets + Drive via GAS; no client APIs) ---- */
$("#shopForm").addEventListener("submit", async (e)=>{
  e.preventDefault();
  const btn = $("#saveBtn");
  setBtnLoading(btn, true);

  try{
    const shopName = $("#shopName").value.trim();
    const rating = Number($("#rating").value || 0);
    const remark = $("#remark").value || "";
    const lat = $("#lat").value || "";
    const lng = $("#lng").value || "";

    if (!shopName){ toast("Please enter Shop Name."); setBtnLoading(btn,false); return; }
    if (!selectedFile){ toast("Please attach a photo."); setBtnLoading(btn,false); return; }

    // 1) Photo → Drive (base64 to GAS)
    const dataUrl = await fileToDataURL(selectedFile);
    const base64 = dataUrlToBase64(dataUrl);
    const filename = makeSafeFilename(shopName, selectedFile.name);

    const photoRes = await fetch(GAS_WEB_APP_URL, {
      method: "POST",
      body: new URLSearchParams({
        action: "photo",
        file: base64,
        filename
      })
    }).then(r=>r.json());

    if(photoRes.status!=="ok") throw new Error("Photo upload failed");
    const photoUrl = photoRes.fileUrl;

    // 2) Entry → Sheet (URL-encoded to avoid preflight/CORS)
    const entryParams = new URLSearchParams({
      action: "entry",
      shopName,
      remark,
      rating: String(rating),
      lat,
      lng,
      photoUrl
    });

    const entryRes = await fetch(GAS_WEB_APP_URL, {
      method: "POST",
      body: entryParams
    }).then(r=>r.json());

    if(entryRes.status!=="ok") throw new Error("Entry save failed");

    toast("Submitted ✅");
    // optional: clear form
    $("#shopForm").reset();
    $("#photoPreview").innerHTML = "";
    selectedFile = null;
    $$("#stars .star").forEach(s=>s.classList.remove("active"));
    $("#rating").value = "0";
  }catch(err){
    console.error(err);
    toast("Submit failed — saved offline.");
    // Save offline fallback
    if (selectedFile){
      const dataUrl = await fileToDataURL(selectedFile);
      const entry = {
        shopName: $("#shopName").value.trim(),
        rating: Number($("#rating").value||0),
        remark: $("#remark").value||"",
        lat: $("#lat").value||null,
        lng: $("#lng").value||null,
        photoDataUrl: dataUrl,
        ts: Date.now()
      };
      const arr = readOffline(); arr.push(entry); writeOffline(arr);
    }
  }finally{
    setBtnLoading(btn, false);
  }
});

function makeSafeFilename(shopName, originalName){
  const ext = (originalName && originalName.includes(".")) ? originalName.split(".").pop() : "jpg";
  const safe = shopName.replace(/[\\/:*?"<>|]+/g,"_").trim();
  return `${safe}.${ext}`;
}

/* ---- Upload all offline entries ---- */
$("#uploadOfflineBtn").addEventListener("click", async ()=>{
  const offline = readOffline();
  if(!offline.length){ toast("No offline entries."); return; }

  for (const it of offline){
    try{
      const filename = `${it.shopName.replace(/[\\/:*?"<>|]+/g,"_").trim()}.jpg`;

      // 1) photo
      const resPhoto = await fetch(GAS_WEB_APP_URL, {
        method: "POST",
        body: new URLSearchParams({
          action: "photo",
          file: dataUrlToBase64(it.photoDataUrl),
          filename
        })
      }).then(r=>r.json());
      if(resPhoto.status!=="ok") throw new Error("Photo upload failed");

      // 2) entry
      const entryParams = new URLSearchParams({
        action: "entry",
        shopName: it.shopName,
        remark: it.remark || "",
        rating: String(it.rating || 0),
        lat: it.lat || "",
        lng: it.lng || "",
        photoUrl: resPhoto.fileUrl
      });
      const resEntry = await fetch(GAS_WEB_APP_URL, {
        method: "POST",
        body: entryParams
      }).then(r=>r.json());
      if(resEntry.status!=="ok") throw new Error("Entry save failed");

      toast(`Uploaded ${it.shopName}`);
    }catch(err){
      console.error(err);
      toast(`Upload failed for ${it.shopName}`);
    }
  }

  // Clear offline cache after attempting all
  localStorage.removeItem(LS_KEY);
  renderOffline();
});

/* ---- Minor: network awareness toast ---- */
window.addEventListener('online', ()=>toast("Back online"));
window.addEventListener('offline', ()=>toast("You’re offline"));
