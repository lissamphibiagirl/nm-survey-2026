const CACHE_NAME = "fishtrap-v2"; // bump this on every deploy so old cached files are dropped
const SHELL_FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./db.js",
  "./species-data.js",
  "./manifest.json",
  "./icon.svg"
  // config.js deliberately excluded — see fetch handler below, it's always
  // fetched fresh from the network rather than cached, since it holds the
  // backend URL and stale copies of it are silent, hard-to-diagnose failures.
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

// Network-first for the Apps Script API and config.js (both need to always be
// fresh — config.js holds the backend URL, and a stale cached copy of it fails
// silently with no useful error), cache-first for the rest of the app shell so
// it still works fully offline.
self.addEventListener("fetch", (event)=>{
  const url = event.request.url;
  if (url.includes("script.google.com")) {
    event.respondWith(fetch(event.request).catch(()=>new Response(JSON.stringify({ok:false,message:"offline"}), {headers:{"Content-Type":"application/json"}})));
    return;
  }
  if (url.includes("config.js")) {
    event.respondWith(
      fetch(event.request, {cache:"no-store"}).catch(()=>caches.match(event.request))
    );
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
