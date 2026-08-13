const CACHE_NAME = "fishtrap-v1";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./db.js",
  "./config.js",
  "./species-data.js",
  "./manifest.json",
  "./icon.svg"
];

self.addEventListener("install", (event)=>{
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache=>cache.addAll(SHELL_FILES)).catch(()=>{})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event)=>{
  event.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k))))
  );
  self.clients.claim();
});

// Network-first for the Apps Script API (needs fresh data / must not be cached),
// cache-first for the app shell so it works fully offline.
self.addEventListener("fetch", (event)=>{
  const url = event.request.url;
  if (url.includes("script.google.com")) {
    event.respondWith(fetch(event.request).catch(()=>new Response(JSON.stringify({ok:false,message:"offline"}), {headers:{"Content-Type":"application/json"}})));
    return;
  }
  event.respondWith(
    caches.match(event.request).then(cached=>{
      if (cached) return cached;
      return fetch(event.request).then(resp=>{
        const respClone = resp.clone();
        caches.open(CACHE_NAME).then(cache=>cache.put(event.request, respClone));
        return resp;
      }).catch(()=>cached);
    })
  );
});
