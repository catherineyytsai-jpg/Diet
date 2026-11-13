/* Cache only public app shell. Never cache user photos, API responses or auth data. */
const CACHE_NAME='daily-plate-shell-v38';
const SHELL=['./offline.html','./styles.css','./app.js','./icons/icon-v3-192.png','./icons/icon-v3-512.png','./icons/apple-touch-icon-v3.png','./manifest.webmanifest'];
self.addEventListener('install',event=>{
 event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
 event.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('daily-plate-shell-')&&key!==CACHE_NAME).map(key=>caches.delete(key)))),self.clients.claim()]));
});
self.addEventListener('fetch',event=>{
 const request=event.request;
 if(request.method!=='GET')return;
 const url=new URL(request.url);
 if(url.origin!==self.location.origin||url.pathname.includes('/api/')||url.pathname.endsWith('/config.js'))return;
 if(request.mode==='navigate'){
  event.respondWith(fetch(request).catch(()=>caches.match('./offline.html')));
  return;
 }
 if(SHELL.some(asset=>url.pathname===new URL(asset,self.registration.scope).pathname)){
  event.respondWith(fetch(request).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE_NAME).then(cache=>cache.put(request,copy));}return response}).catch(()=>caches.match(request)));
 }
});
