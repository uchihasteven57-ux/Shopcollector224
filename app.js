/* ========= CONFIG ========= */
const GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbwSHb7IxJqFn8RsClq5ptHWVVFjGc36EYyRd5XlXEWAfTkXsBGZCdyvfZ8VQhhshWz0/exec";
/* ========================= */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function toast(msg){ const t=$("#toast"); t.textContent=msg; t.classList.add("show"); setTimeout(()=>t.classList.remove("show"),2600); }
function setBtnLoading(btn, loading){ btn.classList.toggle("loading", !!loading); btn.disabled = !!loading; }

/* ---- Location ---- */
async function getLocation(){
  if (!('geolocation' in navigator)) { $("#locBadge").textContent = "Geolocation not supported"; return; }
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
      () => { $("#locBadge").textContent = "Location denied"; resolve(false); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });
}
window.addEventListener("load", getLocation);
$("#refreshLoc").addEventListener("click", getLocation);

/* ---- Stars ---- */
(function initStars(){
  const starEls = $$("#stars .star");
  starEls.forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const val = Number(btn.dataset.value);
      $("#rating").value = val;
      starEls.forEach(b=>{
        const active = Number(b.dataset.value) <= val;
        b.classList.toggle("active", active);
      });
    });
  });
})();

/* ---- Photo preview ---- */
let selectedFile = null;
$("#photo").addEventListener("change", async (e)=>{
  const file = e.target.files?.[0];
  selectedFile = file || null;
  const preview = $("#photoPreview"); preview.innerHTML = "";
  if (!file) return;
  const url = URL.createObjectURL(file);
  preview.innerHTML = `<div class="thumb"><img src="${url}" alt="Selected photo"><span class="badge">Selected</span></div>`;
});

/* ---- Local cache ---- */
const LS_KEY = "shoplogger_offline_entries";
function readOffline(){ try{ return JSON.parse(localStorage.getItem(LS_KEY)||"[]"); }catch{ return []; } }
function writeOffline(arr){ localStorage.setItem(LS_KEY, JSON.stringify(arr)); renderOffline(); }
function renderOffline(){ const list=$("#offlineList"); list.innerHTML=""; readOffline().forEach(it=>{ const d=document.createElement("div"); d.className="thumb"; d.innerHTML=`<img src="${it.photoDataUrl}" alt="${it.shopName}"><span class="badge">${it.shopName} • ${it.rating}★</span>`; list.appendChild(d); }); }
renderOffline();

async function fileToDataURL(file){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(file); }); }
function dataUrlToBase64(dataUrl){ return dataUrl.split(",")[1]||""; }
function makeSafeFilename(shopName, originalName){ const ext=(originalName&&originalName.includes("."))?originalName.split(".").pop():"jpg"; const safe=shopName.replace(/[\\/:*?"<>|]+/g,"_").trim(); return `${safe}.${ext}`; }

/* ---- Clear Form (keeps location) ---- */
function clearFormKeepLocation(){
  $("#shopName").value="";
  $("#remark").value="";
  $("#rating").value="0";
  $$("#stars .star").forEach(s=>s.classList.remove("active"));
  $("#photo").value="";
  $("#photoPreview").innerHTML="";
  selectedFile=null;
}
$("#clearBtn").addEventListener("click", ()=>{ clearFormKeepLocation(); toast("Form cleared"); });

/* ---- Save offline ---- */
$("#saveLocalBtn").addEventListener("click", async ()=>{
  const shopName = $("#shopName").value.trim();
  if(!shopName){ toast("Shop Name is required."); return; }
  if(!selectedFile){ toast("Please add a photo."); return; }
  const rating = Number($("#rating").value||0);
  const remark = $("#remark").value||"";
  const lat=$("#lat").value||null, lng=$("#lng").value||null;
  const photoDataUrl = await fileToDataURL(selectedFile);
  const items = readOffline(); items.push({shopName,rating,remark,lat,lng,photoDataUrl,ts:Date.now()});
  writeOffline(items);
  toast("Saved offline.");
  clearFormKeepLocation();
});

/* ---- Submit ---- */
$("#shopForm").addEventListener("submit", async (e)=>{
  e.preventDefault(); const btn=$("#saveBtn"); setBtnLoading(btn,true);
  try{
    const shopName=$("#shopName").value.trim(), rating=Number($("#rating").value||0), remark=$("#remark").value||"", lat=$("#lat").value||"", lng=$("#lng").value||"";
    if (!shopName){ toast("Please enter Shop Name."); setBtnLoading(btn,false); return; }
    if (!selectedFile){ toast("Please attach a photo."); setBtnLoading(btn,false); return; }

    const dataUrl = await fileToDataURL(selectedFile); const base64=dataUrlToBase64(dataUrl); const filename=makeSafeFilename(shopName, selectedFile.name);

    const photoRes=await fetch(GAS_WEB_APP_URL,{method:"POST",body:new URLSearchParams({action:"photo",file:base64,filename})}).then(r=>r.json());
    if(photoRes.status!=="ok") throw new Error("Photo upload failed");

    const entryRes=await fetch(GAS_WEB_APP_URL,{method:"POST",body:new URLSearchParams({action:"entry",shopName,remark,rating:String(rating),lat,lng,photoUrl:photoRes.fileUrl})}).then(r=>r.json());
    if(entryRes.status!=="ok") throw new Error("Entry save failed");

    toast("Submitted ✅"); clearFormKeepLocation();
  }catch(err){ console.error(err); toast("Submit failed — saved offline."); if(selectedFile){ const dataUrl=await fileToDataURL(selectedFile); const entry={shopName:$("#shopName").value.trim(),rating:Number($("#rating").value||0),remark:$("#remark").value||"",lat:$("#lat").value||null,lng:$("#lng").value||null,photoDataUrl:dataUrl,ts:Date.now()}; const arr=readOffline(); arr.push(entry); writeOffline(arr); clearFormKeepLocation(); } }
  finally{ setBtnLoading(btn,false); }
});

/* ---- Upload offline ---- */
$("#uploadOfflineBtn").addEventListener("click", async ()=>{
  const btn=$("#uploadOfflineBtn"); btn.classList.add("btn-loading"); btn.disabled=true;
  const offline=readOffline(); if(!offline.length){ toast("No offline entries."); btn.classList.remove("btn-loading"); btn.disabled=false; return; }

  for(const it of offline){ 
    try{ 
      const filename=`${it.shopName.replace(/[\\/:*?"<>|]+/g,"_").trim()}.jpg`;
      const resPhoto=await fetch(GAS_WEB_APP_URL,{method:"POST",body:new URLSearchParams({action:"photo",file:dataUrlToBase64(it.photoDataUrl),filename})}).then(r=>r.json());
      if(resPhoto.status!=="ok") throw new Error("Photo upload failed");
      const resEntry=await fetch(GAS_WEB_APP_URL,{method:"POST",body:new URLSearchParams({action:"entry",shopName:it.shopName,remark:it.remark||"",rating:String(it.rating||0),lat:it.lat||"",lng:it.lng||"",photoUrl:resPhoto.fileUrl})}).then(r=>r.json());
      if(resEntry.status!=="ok") throw new Error("Entry save failed");
      toast(`Uploaded ${it.shopName}`);
    }catch(err){ console.error(err); toast(`Upload failed for ${it.shopName}`); }
  }

  localStorage.removeItem(LS_KEY); renderOffline();
  btn.classList.remove("btn-loading"); btn.disabled=false;
});

/* ---- Network awareness ---- */
window.addEventListener('online', ()=>toast("Back online"));
window.addEventListener('offline', ()=>toast("You’re offline"));
