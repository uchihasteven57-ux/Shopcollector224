// Basic offline cache for PWA shell
const CACHE = "shoplogger-cache-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS);
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));
    self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return; // let non-GET pass through (e.g., Web App POSTs)
  e.respondWith((async ()=>{
    const cached = await caches.match(request);
    if (cached) return cached;
    try{
      const res = await fetch(request);
      return res;
    }catch(err){
      // offline fallback: return cached shell if root navigation
      if (request.mode === "navigate") return caches.match("./index.html");
      throw err;
    }
  })());
});
