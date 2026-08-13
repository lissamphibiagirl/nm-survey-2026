// ============================================================
// Fish Trap Survey — offline-first PWA logic
// ============================================================

const CFG = window.APP_CONFIG;
let currentSpecies = [];   // species cards for the active check-in form
let swIdx = 0;
const SWATCHES = ["sw-a","sw-b","sw-c","sw-d"];
let currentTab = "all";
let searchQ = "";
let addedSpeciesNames = new Set();
let pendingPhoto = null;   // {dataUrl, base64} awaiting AI confirmation
let serverToday = { deployments: [], checkins: [] };

// ---------- small helpers ----------
function pad(n){ return String(n).padStart(2,"0"); }
function todayISO(){ const d=new Date(); return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate()); }
function nowTime(){ const d=new Date(); return pad(d.getHours())+":"+pad(d.getMinutes()); }
function nowISO(){ return new Date().toISOString(); }
function newId(prefix){ return prefix+"-"+Date.now()+"-"+Math.random().toString(36).slice(2,7); }
function $(id){ return document.getElementById(id); }
function toast(msg, ms=3200){
  const el = document.createElement("div");
  el.className = "toast"; el.textContent = msg;
  $("toast-slot").appendChild(el);
  setTimeout(()=>el.remove(), ms);
}
function soakMins(deployTime, checkTime){
  try{
    const [dh,dm] = deployTime.split(":").map(Number);
    const [ch,cm] = checkTime.split(":").map(Number);
    let m = (ch*60+cm) - (dh*60+dm);
    if (m < 0) m += 1440;
    return m;
  }catch(e){ return null; }
}
function fmtSoak(mins){
  if (mins === null || mins === undefined || isNaN(mins)) return "--";
  const h = Math.floor(mins/60), m = mins%60;
  return h === 0 ? m+"m" : h+"h "+pad(m)+"m";
}
function elapsedMins(deployTime){
  try{
    const [h,m] = deployTime.split(":").map(Number);
    const now = new Date();
    return (now.getHours()*60+now.getMinutes()) - (h*60+m);
  }catch(e){ return 0; }
}

// ---------- screen nav ----------
function showScreen(id){
  document.querySelectorAll(".screen").forEach(s=>s.classList.remove("active"));
  const el = $(id); if (el){ el.classList.add("active"); window.scrollTo(0,0); }
}
function switchMode(mode){
  $("pill-deploy").className = "mode-pill" + (mode==="deploy" ? " active-deploy" : "");
  $("pill-checkin").className = "mode-pill" + (mode==="checkin" ? " active-checkin" : "");
  $("pill-mudpuppies").className = "mode-pill" + (mode==="mudpuppies" ? " active-mudpuppy" : "");
  $("view-deploy").style.display = mode==="deploy" ? "" : "none";
  $("view-checkin").style.display = mode==="checkin" ? "" : "none";
  $("view-mudpuppies").style.display = mode==="mudpuppies" ? "" : "none";
  if (mode==="mudpuppies") renderMudpuppyList();
}
window.showScreen = showScreen;
window.switchMode = switchMode;

// ---------- trap dropdown ----------
function buildTrapDropdown(){
  const dd = $("dd-deploy-trap");
  dd.innerHTML = "";
  window.TRAP_IDS.forEach(id=>{
    const opt = document.createElement("div");
    opt.className = "select-option"; opt.textContent = id; opt.dataset.val = id;
    opt.onclick = ()=>selectTrap(id);
    dd.appendChild(opt);
  });
}
function selectTrap(val){
  document.querySelectorAll("#dd-deploy-trap .select-option").forEach(o=>o.classList.toggle("selected", o.dataset.val===val));
  $("val-deploy-trap").textContent = val;
  $("dd-deploy-trap").classList.remove("open");
  $("trigger-deploy-trap").classList.remove("open");
  state.deployTrap = val;
}
function toggleDd(ddId, trigger){
  const dd = $(ddId);
  const isOpen = dd.classList.contains("open");
  document.querySelectorAll(".select-dropdown").forEach(d=>d.classList.remove("open"));
  document.querySelectorAll(".select-trigger").forEach(t=>t.classList.remove("open"));
  if (!isOpen){ dd.classList.add("open"); trigger.classList.add("open"); }
}
document.addEventListener("click", (e)=>{
  if (!e.target.closest(".custom-select")){
    document.querySelectorAll(".select-dropdown").forEach(d=>d.classList.remove("open"));
    document.querySelectorAll(".select-trigger").forEach(t=>t.classList.remove("open"));
  }
});
window.toggleDd = toggleDd;

// ---------- survey site chips ----------
function buildSiteChips(){
  const wrap = $("deploy-site-chips");
  wrap.innerHTML = "";
  window.SURVEY_SITES.forEach((s,i)=>{
    const chip = document.createElement("div");
    chip.className = "chip" + (i===3 ? " sel-water" : ""); // default: Wolf Lake
    chip.textContent = s;
    chip.onclick = ()=>{
      wrap.querySelectorAll(".chip").forEach(c=>c.classList.remove("sel-water"));
      chip.classList.add("sel-water");
      state.deploySite = s;
    };
    wrap.appendChild(chip);
  });
  state.deploySite = window.SURVEY_SITES[3];
}

// ---------- state for in-progress forms ----------
const state = {
  deployTrap: "", deploySite: "", deployGpsLat: "", deployGpsLng: "",
  checkinTrapId: "", checkinGpsLat: "", checkinGpsLng: "",
  condClarity: "clear", condWeather: "sunny"
};

// ---------- GPS ----------
const GPS_ACCURACY_WARN_M = 25; // fixes worse than this get flagged, not blocked

function captureGPS(scope){
  const btn = $("gps-btn-"+scope), ico = $("gps-ico-"+scope);
  btn.classList.remove("captured", "low-accuracy");
  $("gps-main-"+scope).textContent = "Getting location...";
  $("gps-sub-"+scope).textContent = "Contacting GPS";
  $("gps-tick-"+scope).style.opacity = "0";
  ico.classList.add("pulsing");
  if (!navigator.geolocation){
    $("gps-main-"+scope).textContent = "Geolocation not supported";
    ico.classList.remove("pulsing"); return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos)=>{
      const lat = pos.coords.latitude.toFixed(6), lng = pos.coords.longitude.toFixed(6);
      const acc = Math.round(pos.coords.accuracy);
      const lowAcc = acc > GPS_ACCURACY_WARN_M;
      btn.classList.toggle("captured", !lowAcc);
      btn.classList.toggle("low-accuracy", lowAcc);
      $("gps-main-"+scope).textContent = lat+", "+lng;
      $("gps-sub-"+scope).textContent = lowAcc
        ? "+/-"+acc+"m — low accuracy, tap to retry"
        : "+/-"+acc+"m  tap to refresh";
      const tick = $("gps-tick-"+scope);
      tick.textContent = lowAcc ? "!" : "OK";
      tick.style.opacity = "1";
      ico.classList.remove("pulsing");
      if (scope==="deploy"){ state.deployGpsLat=lat; state.deployGpsLng=lng; }
      else { state.checkinGpsLat=lat; state.checkinGpsLng=lng; }
    },
    (err)=>{
      const msgs = {1:"Permission denied - check browser settings.",2:"Position unavailable.",3:"Timed out - try again."};
      $("gps-main-"+scope).textContent = msgs[err.code] || "Error getting location";
      $("gps-sub-"+scope).textContent = "Tap to try again";
      ico.classList.remove("pulsing");
    },
    { enableHighAccuracy:true, timeout:15000, maximumAge:0 }
  );
}
window.captureGPS = captureGPS;

// ---------- water condition taps ----------
function pickCond(el, group){
  el.closest(".cond-tap-row").querySelectorAll(".cond-tap").forEach(t=>t.classList.remove("active"));
  el.classList.add("active");
  state["cond"+group.charAt(0).toUpperCase()+group.slice(1)] = el.dataset.val;
}
window.pickCond = pickCond;

// ============================================================
// SPECIES PICKER SHEET
// ============================================================
function buildSheetTabs(){
  const tabs = [["all","All"],["warmwater","Warmwater"],["greatlakes","Great Lakes"],
                ["invasive","Invasive"],["minnow","Minnows"],["other","Other"]];
  const wrap = $("sheet-tabs"); wrap.innerHTML = "";
  tabs.forEach(([key,label])=>{
    const t = document.createElement("div");
    t.className = "sheet-tab" + (key==="all" ? " active" : "");
    t.textContent = label;
    t.onclick = ()=>{ currentTab=key; wrap.querySelectorAll(".sheet-tab").forEach(x=>x.classList.remove("active")); t.classList.add("active"); renderSheet(); };
    wrap.appendChild(t);
  });
}
function openSheet(){
  renderSheet();
  $("sheet-overlay").classList.add("open");
  $("sheet-search").value = ""; searchQ = "";
}
function closeSheet(){ $("sheet-overlay").classList.remove("open"); }
function overlayClick(e){ if (e.target === $("sheet-overlay")) closeSheet(); }
function filterSheet(){ searchQ = $("sheet-search").value.toLowerCase(); renderSheet(); }
window.openSheet = openSheet;
window.closeSheet = closeSheet;
window.overlayClick = overlayClick;
window.filterSheet = filterSheet;

function renderSheet(){
  const list = $("sheet-list"); list.innerHTML = "";
  const cats = currentTab==="all" ? ["warmwater","greatlakes","invasive","minnow","other"] : [currentTab];
  let any = false;
  cats.forEach(cat=>{
    const items = window.SPECIES_DATA[cat].filter(([name,sci])=>{
      if (!searchQ) return true;
      return name.toLowerCase().includes(searchQ) || sci.toLowerCase().includes(searchQ);
    });
    if (!items.length) return;
    any = true;
    if (currentTab==="all"){
      const gl = document.createElement("div"); gl.className="sheet-group-lbl"; gl.textContent = window.CAT_LABELS[cat];
      list.appendChild(gl);
    }
    items.forEach(([name,sci])=>{
      const isSel = addedSpeciesNames.has(name);
      const row = document.createElement("div");
      row.className = "sheet-item" + (isSel ? " sel" : "");
      row.innerHTML = `<div class="sheet-item-dot"></div><div class="sheet-item-info"><div class="sheet-item-name">${name}</div>${sci?`<div class="sheet-item-sci">${sci}</div>`:""}</div><span class="sheet-item-check">OK</span>`;
      row.onclick = ()=>toggleSpecies(name, sci);
      list.appendChild(row);
    });
  });
  if (!any){
    const e = document.createElement("div");
    e.style.cssText = "padding:2rem 1rem;text-align:center;color:var(--parch3);font-size:.84rem;";
    e.textContent = `No results for "${searchQ}"`;
    list.appendChild(e);
  }
}

function toggleSpecies(name, sci, opts={}){
  if (addedSpeciesNames.has(name) && !opts.forceAdd){
    addedSpeciesNames.delete(name);
    currentSpecies = currentSpecies.filter(c=>c.name!==name);
  } else {
    addedSpeciesNames.add(name);
    const sw = SWATCHES[swIdx % SWATCHES.length]; swIdx++;
    currentSpecies.push({
      id: newId("SP"), name, sci, count: opts.count || 1, flagged: false,
      swatch: sw, photoDataUrl: opts.photoDataUrl || null, photoBase64: opts.photoBase64 || null,
      aiSuggested: !!opts.aiSuggested, aiConfidence: opts.aiConfidence || null
    });
  }
  renderSpeciesCards();
  if ($("sheet-overlay").classList.contains("open")) renderSheet();
}
window.toggleSpecies = toggleSpecies;

function renderSpeciesCards(){
  const wrap = $("checkin-sp-list"); wrap.innerHTML = "";
  currentSpecies.forEach(card=>{
    const el = document.createElement("div");
    el.className = "sp-card" + (card.count===0 ? " zero-warn" : "") + (card.aiSuggested ? " ai-unconfirmed" : "");
    const swatchStyle = card.photoDataUrl ? `style="background-image:url('${card.photoDataUrl}')"` : "";
    el.innerHTML = `
      <div class="sp-row">
        <div class="sp-swatch ${card.swatch}" ${swatchStyle}>${card.photoDataUrl ? "" : "F"}</div>
        <div class="sp-info">
          <div class="sp-name">${card.name}</div>
          ${card.sci ? `<div class="sp-sci">${card.sci}</div>` : ""}
          ${card.aiSuggested ? `<div class="sp-ai-tag">AI suggested (${card.aiConfidence||"?"}%) — tap name to confirm</div>` : ""}
        </div>
        <div class="sp-ctr">
          <button class="ctr-btn" onclick="changeCount('${card.id}',-1)">-</button>
          <span class="ctr-val">${card.count}</span>
          <button class="ctr-btn" onclick="changeCount('${card.id}',1)">+</button>
        </div>
        <div class="sp-actions">
          <button class="sp-flag ${card.flagged?'flagged':''}" onclick="toggleFlag('${card.id}')">!</button>
          <button class="sp-del" onclick="removeCard('${card.id}')">x</button>
        </div>
      </div>`;
    if (card.aiSuggested){
      el.querySelector(".sp-name").style.cursor = "pointer";
      el.querySelector(".sp-name").onclick = ()=>confirmAiCard(card.id);
    }
    wrap.appendChild(el);
  });
  syncSpecies();
  renderRecentSpecies();
}
function confirmAiCard(id){
  const card = currentSpecies.find(c=>c.id===id);
  if (card){ card.aiSuggested = false; renderSpeciesCards(); toast("Species confirmed."); }
}
function changeCount(id, delta){
  const card = currentSpecies.find(c=>c.id===id);
  if (!card) return;
  card.count = Math.max(0, card.count + delta);
  renderSpeciesCards();
}
function toggleFlag(id){
  const card = currentSpecies.find(c=>c.id===id);
  if (card){ card.flagged = !card.flagged; renderSpeciesCards(); }
}
function removeCard(id){
  const card = currentSpecies.find(c=>c.id===id);
  if (card) addedSpeciesNames.delete(card.name);
  currentSpecies = currentSpecies.filter(c=>c.id!==id);
  renderSpeciesCards();
  if ($("sheet-overlay").classList.contains("open")) renderSheet();
}
window.changeCount = changeCount;
window.toggleFlag = toggleFlag;
window.removeCard = removeCard;

// ---------- recently-used species (one-tap re-add for repeat sites) ----------
const RECENT_SP_KEY = "fishtrap_recent_species";
function getRecentSpecies(){
  try{ return JSON.parse(localStorage.getItem(RECENT_SP_KEY) || "[]"); }catch(e){ return []; }
}
function addToRecentSpecies(cards){
  let recent = getRecentSpecies();
  cards.forEach(c=>{
    recent = recent.filter(r=>r.name!==c.name);
    recent.unshift({ name: c.name, sci: c.sci });
  });
  recent = recent.slice(0, 8);
  try{ localStorage.setItem(RECENT_SP_KEY, JSON.stringify(recent)); }catch(e){}
}
function renderRecentSpecies(){
  const slot = $("recent-sp-slot");
  const recent = getRecentSpecies().filter(r=>!addedSpeciesNames.has(r.name));
  if (!recent.length){ slot.innerHTML = ""; return; }
  slot.innerHTML = `<div class="recent-sp-row">${recent.map(r=>
    `<div class="recent-sp-chip" onclick="toggleSpecies('${escapeAttr(r.name)}','${escapeAttr(r.sci||"")}')">${r.name}</div>`
  ).join("")}</div>`;
}

function syncSpecies(){
  const total = currentSpecies.reduce((a,c)=>a+c.count, 0);
  $("checkin-total-val").textContent = `${total} fish | ${currentSpecies.length} species`;
}

// ============================================================
// PHOTO-BASED SPECIES ID (bycatch photo -> iNaturalist suggestion)
// ============================================================
function triggerSpeciesPhoto(){ $("species-photo-input").click(); }
window.triggerSpeciesPhoto = triggerSpeciesPhoto;

document.getElementById("species-photo-input").addEventListener("change", async (e)=>{
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const dataUrl = await fileToDataUrl(file);
  const base64 = dataUrl.split(",")[1];
  pendingPhoto = { dataUrl, base64 };
  showAiBanner("loading");
  if (!navigator.onLine){
    showAiBanner("offline");
    return;
  }
  try{
    const resp = await callServer("identify", { image: base64, lat: state.checkinGpsLat, lng: state.checkinGpsLng });
    if (resp && resp.ok && resp.suggestions && resp.suggestions.length){
      showAiBanner("result", resp.suggestions);
    } else {
      showAiBanner("noresult", resp && resp.message);
    }
  }catch(err){
    showAiBanner("error");
  }
});

function fileToDataUrl(file){
  return new Promise((resolve,reject)=>{
    const r = new FileReader();
    r.onload = ()=>resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function showAiBanner(mode, payload){
  const slot = $("ai-banner-slot");
  if (mode === "loading"){
    slot.innerHTML = `<div class="ai-banner">Identifying species from photo...</div>`;
  } else if (mode === "offline"){
    slot.innerHTML = `<div class="ai-banner">You're offline — photo saved, add a species manually. It'll be attached to whichever species card you pick below.
      <div class="ai-banner-btns"><button class="ai-accept" onclick="attachPhotoManually()">Attach to a species I'll pick</button></div></div>`;
  } else if (mode === "error"){
    slot.innerHTML = `<div class="ai-banner">Couldn't reach the ID service. Photo kept — pick the species manually.
      <div class="ai-banner-btns"><button class="ai-accept" onclick="attachPhotoManually()">Attach to a species I'll pick</button></div></div>`;
  } else if (mode === "noresult"){
    slot.innerHTML = `<div class="ai-banner">No confident match found. Pick the species manually and we'll attach this photo.
      <div class="ai-banner-btns"><button class="ai-accept" onclick="attachPhotoManually()">Attach to a species I'll pick</button></div></div>`;
  } else if (mode === "result"){
    const top = payload[0];
    slot.innerHTML = `<div class="ai-banner">AI suggests: <b>${top.name}</b>${top.sci?` (<i>${top.sci}</i>)`:""} — ${top.score}% confidence
      <div class="ai-banner-btns">
        <button class="ai-accept" onclick="acceptAiSuggestion('${escapeAttr(top.name)}','${escapeAttr(top.sci||"")}',${top.score})">Use this species</button>
        <button class="ai-reject" onclick="attachPhotoManually()">Pick a different species</button>
      </div></div>`;
  }
}
function escapeAttr(s){ return String(s).replace(/'/g, "\\'"); }

function acceptAiSuggestion(name, sci, score){
  toggleSpecies(name, sci, {
    forceAdd: !addedSpeciesNames.has(name),
    photoDataUrl: pendingPhoto.dataUrl, photoBase64: pendingPhoto.base64,
    aiSuggested: true, aiConfidence: score
  });
  pendingPhoto = null;
  $("ai-banner-slot").innerHTML = "";
  toast("Species added with photo attached.");
}
function attachPhotoManually(){
  toast("Now tap + Add and choose the species — the photo will attach to it.");
  openSheet();
  window._attachPhotoOnNextAdd = true;
}
window.acceptAiSuggestion = acceptAiSuggestion;
window.attachPhotoManually = attachPhotoManually;

// wrap toggleSpecies to catch "attach on next add" flow
const _origToggleSpecies = toggleSpecies;
toggleSpecies = function(name, sci, opts={}){
  if (window._attachPhotoOnNextAdd && pendingPhoto){
    opts = Object.assign({}, opts, { photoDataUrl: pendingPhoto.dataUrl, photoBase64: pendingPhoto.base64 });
    window._attachPhotoOnNextAdd = false; pendingPhoto = null;
    $("ai-banner-slot").innerHTML = "";
  }
  return _origToggleSpecies(name, sci, opts);
};
window.toggleSpecies = toggleSpecies;

// ============================================================
// MUDPUPPY CAUGHT? (check-in form toggle -> count only.
// Photos are deliberately NOT captured here — they're taken later, at the
// point each individual's metadata is actually filled in, from the
// Mudpuppies tab.)
// ============================================================
let mudpuppyCaught = false;
let mudpuppyCount = 1;

function setMudpuppyCaught(yes){
  mudpuppyCaught = yes;
  $("mp-tap-no").classList.toggle("active", !yes);
  $("mp-tap-yes").classList.toggle("active", yes);
  $("mudpuppy-detail").style.display = yes ? "" : "none";
  if (yes) mudpuppyCount = mudpuppyCount || 1;
}
function changeMudpuppyCount(delta){
  mudpuppyCount = Math.max(1, mudpuppyCount + delta);
  $("mp-count-val").textContent = mudpuppyCount;
}
window.setMudpuppyCaught = setMudpuppyCaught;
window.changeMudpuppyCount = changeMudpuppyCount;

function resetMudpuppyCheckinFields(){
  mudpuppyCaught = false; mudpuppyCount = 1;
  $("mp-tap-no").classList.add("active"); $("mp-tap-yes").classList.remove("active");
  $("mudpuppy-detail").style.display = "none";
  $("mp-count-val").textContent = "1";
}

// ============================================================
// FISH BYCATCH CAUGHT? (check-in form toggle -> count -> one photo per
// individual -> each photo is auto-identified and added straight into
// Species Caught, tagged "AI suggested" until confirmed.)
// ============================================================
let bycatchCaught = false;
let bycatchCount = 1;
let bycatchPhotos = []; // sparse array of {dataUrl, base64} by slot index
let bycatchSlotStatus = []; // "idle" | "loading" | "done" | "error" per slot

function setBycatchCaught(yes){
  bycatchCaught = yes;
  $("bc-tap-no").classList.toggle("active", !yes);
  $("bc-tap-yes").classList.toggle("active", yes);
  $("bycatch-detail").style.display = yes ? "" : "none";
  if (yes){ bycatchCount = bycatchCount || 1; renderBycatchPhotoSlots(); }
}
function changeBycatchCount(delta){
  bycatchCount = Math.max(1, bycatchCount + delta);
  $("bc-count-val").textContent = bycatchCount;
  renderBycatchPhotoSlots();
}
function renderBycatchPhotoSlots(){
  const wrap = $("bycatch-photo-slots"); wrap.innerHTML = "";
  for (let i = 0; i < bycatchCount; i++){
    const photo = bycatchPhotos[i];
    const status = bycatchSlotStatus[i] || "idle";
    const slot = document.createElement("div");
    slot.className = "mp-photo-slot";
    let subLabel = "Tap to add a photo";
    if (status === "loading") subLabel = "Identifying species...";
    else if (status === "done") subLabel = "Identified — check Species Caught below";
    else if (status === "error") subLabel = "Photo saved — pick species manually below";
    else if (photo) subLabel = "Photo attached — tap to replace";
    slot.innerHTML = `
      <div class="thumb" style="${photo ? `background-image:url('${photo.dataUrl}')` : ""}"></div>
      <div class="lbl">Individual #${i+1}<small>${subLabel}</small></div>`;
    slot.onclick = ()=>triggerBycatchPhoto(i);
    wrap.appendChild(slot);
  }
}
let _bcPhotoTargetIndex = null;
function triggerBycatchPhoto(i){ _bcPhotoTargetIndex = i; $("bycatch-photo-input").click(); }
window.setBycatchCaught = setBycatchCaught;
window.changeBycatchCount = changeBycatchCount;
window.triggerBycatchPhoto = triggerBycatchPhoto;

document.addEventListener("DOMContentLoaded", ()=>{
  const input = document.getElementById("bycatch-photo-input");
  if (!input) return;
  input.addEventListener("change", async (e)=>{
    const file = e.target.files[0];
    e.target.value = "";
    const i = _bcPhotoTargetIndex;
    if (!file || i === null) return;
    const dataUrl = await fileToDataUrl(file);
    const base64 = dataUrl.split(",")[1];
    bycatchPhotos[i] = { dataUrl, base64 };
    bycatchSlotStatus[i] = "loading";
    renderBycatchPhotoSlots();

    if (!navigator.onLine){
      bycatchSlotStatus[i] = "error";
      addBycatchFallbackCard(dataUrl, base64, i);
      renderBycatchPhotoSlots();
      return;
    }
    try{
      const resp = await callServer("identify", { image: base64, lat: state.checkinGpsLat, lng: state.checkinGpsLng });
      if (resp && resp.ok && resp.suggestions && resp.suggestions.length){
        const top = resp.suggestions[0];
        toggleSpecies(top.name, top.sci || "", {
          forceAdd: !addedSpeciesNames.has(top.name),
          photoDataUrl: dataUrl, photoBase64: base64,
          aiSuggested: true, aiConfidence: top.score
        });
        bycatchSlotStatus[i] = "done";
        toast(`Individual #${i+1}: AI suggests ${top.name} (${top.score}%).`);
      } else {
        bycatchSlotStatus[i] = "error";
        addBycatchFallbackCard(dataUrl, base64, i);
      }
    }catch(err){
      bycatchSlotStatus[i] = "error";
      addBycatchFallbackCard(dataUrl, base64, i);
    }
    renderBycatchPhotoSlots();
  });
});
function addBycatchFallbackCard(dataUrl, base64, i){
  toggleSpecies(`Unidentified bycatch #${i+1}`, "", {
    forceAdd: true, photoDataUrl: dataUrl, photoBase64: base64, aiSuggested: true, aiConfidence: null
  });
}
function resetBycatchCheckinFields(){
  bycatchCaught = false; bycatchCount = 1; bycatchPhotos = []; bycatchSlotStatus = [];
  $("bc-tap-no").classList.add("active"); $("bc-tap-yes").classList.remove("active");
  $("bycatch-detail").style.display = "none";
  $("bc-count-val").textContent = "1";
  $("bycatch-photo-slots").innerHTML = "";
}

// ============================================================
// MUDPUPPY RECORDS — list + detail metadata editor
// ============================================================
async function mergedMudpuppies(){
  const pending = await DB.getPendingMudpuppies();
  const cached = await DB.getMudpuppyCache();
  const server = cached || [];
  const byId = {};
  server.forEach(m=>byId[m.id] = { ...m, _pending:false });
  pending.forEach(m=>byId[m.id] = { ...m, _pending:true });
  return Object.values(byId).sort((a,b)=> String(b.submitted_at||"").localeCompare(String(a.submitted_at||"")));
}
function isMpComplete(m){
  return !!(m.sex && m.weight_g!=="" && m.weight_g!==undefined && m.svl_mm!=="" && m.svl_mm!==undefined);
}
async function renderMudpuppyList(){
  const list = await mergedMudpuppies();
  const el = $("ui-mudpuppy-list");
  if (!list.length){
    el.innerHTML = `<div class="empty-state"><div class="empty-state-text">No mudpuppies logged yet.<br>Individuals are added from the Check-in form after selecting "Yes" under Mudpuppy Captured.</div></div>`;
    return;
  }
  el.innerHTML = "";
  list.forEach(m=>{
    const card = document.createElement("div");
    card.className = "mp-card";
    card.onclick = ()=>openMudpuppyDetail(m.id);
    const complete = isMpComplete(m);
    card.innerHTML = `
      <div class="thumb" style="${m.photo_url ? `background-image:url('${m.photo_url}')` : (m.photo_base64 ? `background-image:url('data:image/jpeg;base64,${m.photo_base64}')` : "")}"></div>
      <div class="mp-card-info">
        <div class="mp-card-title">Trap ${m.trap_id} · #${m.individual_index} of ${m.total_in_catch}</div>
        <div class="mp-card-meta">${m.catch_date || ""} ${m.site ? "· "+m.site : ""}${m.sex ? " · "+m.sex : ""}${m.weight_g ? " · "+m.weight_g+"g" : ""}${m.glochidia_present === "Yes" ? " · glochidia+" : ""}</div>
      </div>
      ${complete ? `<div class="mp-badge-complete">Complete</div>` : `<div class="mp-badge-incomplete">Needs metadata</div>`}
      ${m._pending ? `<div class="trap-badge-pending">sync pending</div>` : ""}
    `;
    el.appendChild(card);
  });
}
window.renderMudpuppyList = renderMudpuppyList;

async function openMudpuppyDetail(id){
  const list = await mergedMudpuppies();
  const m = list.find(x=>x.id===id);
  if (!m){ toast("Record not found."); return; }
  renderMudpuppyDetailForm(m);
  showScreen("screen-mudpuppy-detail");
}
window.openMudpuppyDetail = openMudpuppyDetail;

function renderMudpuppyDetailForm(m){
  const photoSrc = m.photo_url || (m.photo_base64 ? `data:image/jpeg;base64,${m.photo_base64}` : null);
  _mpDetailNewPhoto = null; // reset any in-progress unsaved photo pick
  const el = $("ui-mudpuppy-detail");
  el.innerHTML = `
    <div class="hero mudpuppy" style="margin-top:.2rem;">
      <div class="hero-eyebrow">Mudpuppy</div>
      <div class="hero-title">Trap ${m.trap_id} · #${m.individual_index} of ${m.total_in_catch}</div>
      <div class="hero-sub">${m.catch_date || ""} ${m.site ? "· "+m.site : ""}</div>
    </div>
    <div class="field-block" style="margin-top:.85rem;">
      <span class="sec-label">Photograph</span>
      <div class="mp-detail-photo" id="mp-detail-photo" style="cursor:pointer;${photoSrc ? `background-image:url('${photoSrc}')` : ""}" onclick="triggerMpDetailPhoto()">${photoSrc ? "" : "Tap to take or upload a photograph"}</div>
      <p style="font-size:.7rem;color:var(--parch3);margin-top:.4rem;line-height:1.5;">
        Taken at processing, not at trap check-in — this is when the individual is in hand.</p>
    </div>
    <div class="field-block">
      <span class="sec-label">Sex</span>
      <div class="sex-chip-row">
        <div class="sex-chip" data-val="M">Male</div>
        <div class="sex-chip" data-val="F">Female</div>
        <div class="sex-chip" data-val="Unknown">Unknown</div>
      </div>
    </div>
    <div class="two-col">
      <div><span class="sec-label">Mass</span>
        <div class="unit-input-row"><input type="number" inputmode="decimal" id="mp-weight" value="${m.weight_g||""}" placeholder="0.0"><span class="unit">g</span></div></div>
      <div><span class="sec-label">SVL</span>
        <div class="unit-input-row"><input type="number" inputmode="decimal" id="mp-svl" value="${m.svl_mm||""}" placeholder="0.0"><span class="unit">mm</span></div></div>
    </div>
    <div class="divider"></div>
    <div class="field-block">
      <span class="sec-label">Glochidia Encystment?</span>
      <div class="cond-tap-row">
        <div class="cond-tap" id="gl-tap-no" data-val="No">No</div>
        <div class="cond-tap" id="gl-tap-yes" data-val="Yes">Yes</div>
        <div class="cond-tap" id="gl-tap-na" data-val="Not examined">Not examined</div>
      </div>
      <div id="glochidia-count-wrap" style="display:none;margin-top:.6rem;">
        <span class="sec-label">Approximate Count</span>
        <div class="unit-input-row"><input type="number" inputmode="numeric" id="mp-glochidia-count" value="${m.glochidia_count||""}" placeholder="0"><span class="unit">glochidia</span></div>
      </div>
    </div>
    <div class="divider"></div>
    <div class="field-block">
      <span class="sec-label">Swab Vial ID</span>
      <input type="text" class="text-input" id="mp-swab" value="${m.swab_vial_id||""}" placeholder="e.g. SW-0142" autocomplete="off">
    </div>
    <div class="field-block">
      <span class="sec-label">PIT Tag ID</span>
      <input type="text" class="text-input" id="mp-pit" value="${m.pit_tag_id||""}" placeholder="e.g. 900226000123456" autocomplete="off">
    </div>
    <div class="field-block">
      <span class="sec-label">Tissue Vial ID</span>
      <input type="text" class="text-input" id="mp-tissue" value="${m.tissue_vial_id||""}" placeholder="e.g. TV-0142" autocomplete="off">
    </div>
    <div class="field-block">
      <span class="sec-label">Notes</span>
      <textarea class="notes-ta" id="mp-notes" rows="2" placeholder="Recapture status, body condition, injuries, abnormalities...">${m.notes||""}</textarea>
    </div>
    <div class="submit-wrap">
      <button class="primary-btn" style="background:var(--clay);" onclick="saveMudpuppyDetail('${m.id}')">Save Metadata</button>
    </div>
    <div id="mp-save-toast-slot"></div>
  `;
  const sexRow = el.querySelector(".sex-chip-row");
  sexRow.querySelectorAll(".sex-chip").forEach(chip=>{
    chip.classList.toggle("active", chip.dataset.val === m.sex);
    chip.onclick = ()=>{ sexRow.querySelectorAll(".sex-chip").forEach(c=>c.classList.remove("active")); chip.classList.add("active"); };
  });

  const glTaps = [$("gl-tap-no"), $("gl-tap-yes"), $("gl-tap-na")];
  const currentGl = m.glochidia_present || "";
  glTaps.forEach(t=>t.classList.toggle("active", t.dataset.val === currentGl));
  $("glochidia-count-wrap").style.display = currentGl === "Yes" ? "" : "none";
  glTaps.forEach(t=>{
    t.onclick = ()=>{
      glTaps.forEach(x=>x.classList.remove("active"));
      t.classList.add("active");
      $("glochidia-count-wrap").style.display = t.dataset.val === "Yes" ? "" : "none";
    };
  });
}

async function saveMudpuppyDetail(id){
  const list = await mergedMudpuppies();
  const existing = list.find(x=>x.id===id) || {};
  const sexChip = document.querySelector("#ui-mudpuppy-detail .sex-chip.active");
  const glChip = document.querySelector("#ui-mudpuppy-detail .cond-tap.active[id^='gl-tap-']");
  const updated = {
    ...existing,
    sex: sexChip ? sexChip.dataset.val : "",
    weight_g: $("mp-weight").value,
    svl_mm: $("mp-svl").value,
    glochidia_present: glChip ? glChip.dataset.val : "",
    glochidia_count: glChip && glChip.dataset.val === "Yes" ? $("mp-glochidia-count").value : "",
    swab_vial_id: $("mp-swab").value.trim(),
    pit_tag_id: $("mp-pit").value.trim(),
    tissue_vial_id: $("mp-tissue").value.trim(),
    notes: $("mp-notes").value.trim(),
    updated_at: nowISO()
  };
  if (_mpDetailNewPhoto){
    updated.photo_base64 = _mpDetailNewPhoto.base64; // only sent when a new photo was actually picked
  }
  delete updated._pending;
  await DB.addPendingMudpuppy(updated);
  _mpDetailNewPhoto = null;
  buzz(40);
  $("mp-save-toast-slot").innerHTML = `<div class="mp-save-toast">Saved${navigator.onLine ? " — syncing now" : " on this device — will sync once online"}.</div>`;
  trySyncAll();
}
window.saveMudpuppyDetail = saveMudpuppyDetail;

// Photo capture for the mudpuppy metadata editor — this is the ONLY place
// mudpuppy photos are taken, deliberately deferred from check-in time.
let _mpDetailNewPhoto = null;
function triggerMpDetailPhoto(){ $("mp-detail-photo-input").click(); }
window.triggerMpDetailPhoto = triggerMpDetailPhoto;
document.addEventListener("DOMContentLoaded", ()=>{
  const input = document.getElementById("mp-detail-photo-input");
  if (!input) return;
  input.addEventListener("change", async (e)=>{
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const dataUrl = await fileToDataUrl(file);
    _mpDetailNewPhoto = { dataUrl, base64: dataUrl.split(",")[1] };
    const box = $("mp-detail-photo");
    if (box){ box.style.backgroundImage = `url('${dataUrl}')`; box.textContent = ""; }
  });
});

async function mergedDeployments(){
  const pending = await DB.getPendingDeployments();
  const server = (serverToday.deployments || []);
  const byTrap = {};
  server.forEach(d=>byTrap[d.trap_id] = { ...d, _pending:false });
  pending.forEach(d=>byTrap[d.trap_id] = { ...d, _pending:true }); // local always wins if newer
  return Object.values(byTrap);
}
async function mergedCheckins(){
  const pending = await DB.getPendingCheckins();
  const server = (serverToday.checkins || []);
  const byTrap = {};
  server.forEach(c=>byTrap[c.trap_id] = { ...c, _pending:false });
  pending.forEach(c=>byTrap[c.trap_id] = { ...c, _pending:true });
  return Object.values(byTrap);
}

async function renderHome(){
  const deps = await mergedDeployments();
  const checks = await mergedCheckins();
  const doneIds = new Set(checks.map(c=>c.trap_id));

  // deploy list
  const dl = $("ui-deploy-list");
  if (!deps.length){
    dl.innerHTML = `<div class="empty-state"><div class="empty-state-text">No traps deployed today.<br>Tap "+ Deploy new trap" below to begin.</div></div>`;
  } else {
    dl.innerHTML = "";
    deps.forEach(d=>{
      const done = doneIds.has(d.trap_id);
      const em = elapsedMins(d.deploy_time);
      const card = document.createElement("div");
      card.className = "trap-card " + (done ? "st-done" : "st-deployed");
      card.onclick = ()=>{ state.viewTrap = d.trap_id; renderDeployDetail(d.trap_id); showScreen("screen-deploy-detail"); };
      card.innerHTML = `<div class="trap-card-inner">
        <div class="trap-status-dot ${done?'dot-done':'dot-deployed'}"></div>
        <div class="trap-card-info">
          <div class="trap-card-id">Trap ${d.trap_id}</div>
          <div class="trap-card-meta">${d.site||d.watershed||""} | ${d.deploy_time}${d.gps_lat?` | ${d.gps_lat}, ${d.gps_lng}`:""}</div>
        </div>
        ${done ? `<div class="trap-badge-done">Done</div>` : `<div class="trap-badge-soak">${fmtSoak(em)}</div>`}
        ${d._pending ? `<div class="trap-badge-pending">sync pending</div>` : ""}
        <div class="trap-card-arrow">&gt;</div>
      </div>`;
      dl.appendChild(card);
    });
  }

  // checkin list (pending traps)
  const cl = $("ui-checkin-list");
  const pendingTraps = deps.filter(d=>!doneIds.has(d.trap_id));
  if (!pendingTraps.length){
    cl.innerHTML = `<div class="empty-state"><div class="empty-state-text">${deps.length ? "All deployed traps have been checked in." : "No active deployments — switch to Deploy to set traps first."}</div></div>`;
  } else {
    cl.innerHTML = "";
    pendingTraps.forEach(d=>{
      const em = elapsedMins(d.deploy_time);
      const card = document.createElement("div");
      card.className = "trap-card st-deployed";
      card.onclick = ()=>{ startCheckin(d.trap_id); };
      card.innerHTML = `<div class="trap-card-inner">
        <div class="trap-status-dot dot-deployed"></div>
        <div class="trap-card-info">
          <div class="trap-card-id">Trap ${d.trap_id}</div>
          <div class="trap-card-meta">${d.site||d.watershed||""} | deployed ${d.deploy_time}${d.gps_lat?` | ${d.gps_lat}, ${d.gps_lng}`:""}</div>
        </div>
        <div class="trap-badge-soak">${fmtSoak(em)}</div>
        <div class="trap-card-arrow">&gt;</div>
      </div>`;
      cl.appendChild(card);
    });
  }

  // done list
  const dn = $("ui-done-list");
  if (!checks.length){ dn.innerHTML = ""; }
  else {
    const mudpuppies = await mergedMudpuppies();
    dn.innerHTML = `<span class="trap-list-lbl" style="margin-top:.6rem;display:block;">Completed today</span>`;
    checks.forEach(c=>{
      const mpForTrap = mudpuppies.filter(m=>m.trap_id===c.trap_id);
      const card = document.createElement("div");
      card.className = "trap-card"; card.style.opacity = ".8";
      card.innerHTML = `<div class="trap-card-inner">
        <div class="trap-status-dot dot-done"></div>
        <div class="trap-card-info"><div class="trap-card-id">Trap ${c.trap_id}</div><div class="trap-card-meta">Catch logged${c._pending?" — sync pending":""}</div></div>
        ${mpForTrap.length ? `<div class="trap-badge-mudpuppy" onclick="event.stopPropagation();switchMode('mudpuppies');showScreen('screen-home');">${mpForTrap.length} mudpuppy${mpForTrap.length>1?"s":""}</div>` : ""}
        <div class="trap-badge-done">Done</div>
      </div>`;
      dn.appendChild(card);
    });
  }
}

async function renderDeployDetail(trapId){
  const deps = await mergedDeployments();
  const dep = deps.find(d=>d.trap_id===trapId);
  const el = $("ui-deploy-detail");
  if (!dep){ el.innerHTML = "<p>Trap not found.</p>"; return; }
  const em = elapsedMins(dep.deploy_time);
  el.innerHTML = `
    <div class="hero deploy" style="margin-top:.2rem;">
      <div class="hero-eyebrow">Deployed</div>
      <div class="hero-title">Trap ${dep.trap_id}</div>
      <div class="hero-sub">${dep.site||dep.watershed||""} | awaiting check-in</div>
    </div>
    <div class="field-block" style="margin-top:.85rem;">
      <div class="soak-card">
        <div class="soak-icon">SOAK</div>
        <div class="soak-info"><div class="soak-lbl">Time in water</div><div class="soak-val">Set ${dep.deploy_time} -&gt; now</div></div>
        <div class="soak-badge">${fmtSoak(em)}</div>
      </div>
    </div>
    <div class="field-block">
      <span class="sec-label">Deployment Details</span>
      <div class="success-card">
        <div class="success-row"><span>Trap</span><span class="success-row-val">${dep.trap_id}</span></div>
        <div class="success-row"><span>Survey Site</span><span class="success-row-val">${dep.site||dep.watershed||""}</span></div>
        <div class="success-row"><span>Deployed</span><span class="success-row-val">${dep.deploy_date} ${dep.deploy_time}</span></div>
        <div class="success-row"><span>GPS</span><span class="success-row-val">${dep.gps_lat}, ${dep.gps_lng}</span></div>
        ${dep.notes ? `<div class="success-row"><span>Notes</span><span class="success-row-val">${dep.notes}</span></div>` : ""}
      </div>
    </div>
    <div class="submit-wrap">
      <button class="primary-btn btn-checkin" onclick="startCheckin('${dep.trap_id}')">Check in this trap</button>
    </div>`;
}
window.startCheckin = async function(trapId){
  state.checkinTrapId = trapId;
  currentSpecies = []; addedSpeciesNames.clear(); swIdx = 0; pendingPhoto = null;
  $("ai-banner-slot").innerHTML = "";
  resetMudpuppyCheckinFields();
  resetBycatchCheckinFields();
  const deps = await mergedDeployments();
  const dep = deps.find(d=>d.trap_id===trapId);
  const site = dep ? (dep.site||dep.watershed||"") : "";
  const depTime = dep ? dep.deploy_time : "--";
  $("ui-checkin-hero").innerHTML = `
    <div class="hero checkin" style="margin-top:.2rem;">
      <div class="hero-eyebrow">Check-in</div>
      <div class="hero-title">Trap ${trapId}</div>
      <div class="hero-sub">${site} | deployed ${depTime}</div>
    </div>`;
  const ct = nowTime();
  $("d-checkin-date").textContent = new Date().toDateString().slice(4);
  $("d-checkin-time").textContent = ct;
  const mins = dep ? soakMins(dep.deploy_time, ct) : null;
  $("d-soak-badge").textContent = fmtSoak(mins);
  $("d-soak-val").textContent = dep ? `${dep.deploy_time} -> ${ct}` : "No deployment found";
  renderSpeciesCards();
  renderRecentSpecies();
  showScreen("screen-checkin-form");
};

// ============================================================
// SUBMIT: DEPLOY
// ============================================================
async function submitDeploy(forceDuplicate){
  const trap = state.deployTrap;
  const site = state.deploySite || "Unknown";
  const lat = state.deployGpsLat, lng = state.deployGpsLng;
  const notes = $("deploy-notes").value.trim();
  const errs = [];
  if (!trap) errs.push("Please select a trap number.");
  if (!lat || !lng) errs.push("GPS coordinates are required.");
  if (errs.length){
    $("ui-deploy-error").innerHTML = `<div class="err-box"><div class="err-title">${errs.length} field${errs.length>1?"s":""} need attention:</div><ul class="err-list">${errs.map(e=>`<li>${e}</li>`).join("")}</ul></div>`;
    return;
  }

  if (!forceDuplicate){
    const deps = await mergedDeployments();
    const existing = deps.find(d=>d.trap_id===trap);
    if (existing){
      $("ui-deploy-error").innerHTML = `<div class="confirm-box">
        <p>Trap ${trap} was already deployed today at ${existing.deploy_time}${existing.site?` (${existing.site})`:""}. Log this as a second deployment for the same trap today?</p>
        <div class="confirm-btns">
          <button class="confirm-yes" onclick="submitDeploy(true)">Yes, log it anyway</button>
          <button class="confirm-no" onclick="$('ui-deploy-error').innerHTML=''">Cancel</button>
        </div></div>`;
      return;
    }
  }
  $("ui-deploy-error").innerHTML = "";
  const depTime = nowTime();
  const rec = {
    ref_id: newId("DEP"), submitted_at: nowISO(), trap_id: trap, site,
    deploy_date: todayISO(), deploy_time: depTime, gps_lat: lat, gps_lng: lng, notes
  };
  await DB.addPendingDeployment(rec);
  resetDeployForm();
  buzz(40);
  trySyncAll();
  renderHome();
  $("ui-deploy-success").innerHTML = `
    <div class="success-panel">
      <div class="success-icon deploy-icon">DEPLOYED</div>
      <div class="success-title deploy-color">Trap ${trap} deployed</div>
      <div class="success-sub">Soak timer started. Saved on this device${navigator.onLine?" and syncing now.":" — will sync once you're back online."}</div>
      <div class="success-card">
        <div class="success-row"><span>Trap</span><span class="success-row-val">${trap}</span></div>
        <div class="success-row"><span>Survey Site</span><span class="success-row-val">${site}</span></div>
        <div class="success-row"><span>Deployed</span><span class="success-row-val">${todayISO()} ${depTime}</span></div>
        <div class="success-row"><span>GPS</span><span class="success-row-val">${lat}, ${lng}</span></div>
      </div>
      <button class="action-btn primary-deploy" onclick="$('ui-deploy-success').innerHTML='';showScreen('screen-deploy-form');">Deploy next trap</button>
      <button class="action-btn secondary" onclick="$('ui-deploy-success').innerHTML='';showScreen('screen-home');switchMode('deploy');">Back to overview</button>
    </div>`;
}
window.submitDeploy = submitDeploy;
function resetDeployForm(){
  state.deployTrap=""; state.deployGpsLat=""; state.deployGpsLng="";
  $("val-deploy-trap").textContent = "Select trap...";
  document.querySelectorAll("#dd-deploy-trap .select-option").forEach(o=>o.classList.remove("selected"));
  $("gps-btn-deploy").classList.remove("captured");
  $("gps-main-deploy").textContent = "Tap to capture location";
  $("gps-tick-deploy").style.opacity = "0";
  $("deploy-notes").value = "";
}

// ============================================================
// SUBMIT: CHECK-IN
// ============================================================
async function submitCheckin(){
  const trap = state.checkinTrapId;
  const errs = [];
  if (!trap) errs.push("No trap selected. Go back and tap a trap.");
  if (!currentSpecies.length) errs.push("Please add at least one species using + Add.");
  if (errs.length){
    $("ui-checkin-error").innerHTML = `<div class="err-box"><div class="err-title">${errs.length} field${errs.length>1?"s":""} need attention:</div><ul class="err-list">${errs.map(e=>`<li>${e}</li>`).join("")}</ul></div>`;
    return;
  }
  $("ui-checkin-error").innerHTML = "";

  const deps = await mergedDeployments();
  const dep = deps.find(d=>d.trap_id===trap);
  const depTime = dep ? dep.deploy_time : "";
  const site = dep ? (dep.site||dep.watershed||"Unknown") : "Unknown";
  const checkinTime = nowTime();
  const mins = soakMins(depTime, checkinTime);
  const totalFish = currentSpecies.reduce((a,c)=>a+c.count,0);
  const flagN = currentSpecies.filter(c=>c.flagged).length;
  const ref = newId("CHK");

  const rec = {
    ref_id: ref, submitted_at: nowISO(), checkin_date: todayISO(), checkin_time: checkinTime,
    trap_id: trap, site, deploy_time: depTime, soak_mins: mins,
    gps_lat: state.checkinGpsLat, gps_lng: state.checkinGpsLng,
    clarity: state.condClarity, weather: state.condWeather,
    water_temp_c: $("temp-input").value,
    notes: $("checkin-notes").value.trim(),
    observer: $("observer-name").value.trim(),
    species: currentSpecies.map((c,i)=>({
      species: c.name, sci: c.sci, count: c.count, flagged: c.flagged,
      ai_suggested: c.aiSuggested, ai_confidence: c.aiConfidence,
      sample_id: `${ref}_${slug(c.name)}_${i}`,
      photo_base64: c.photoBase64 || null
    }))
  };

  await DB.addPendingCheckin(rec);
  addToRecentSpecies(currentSpecies);

  // Create one mudpuppy record per individual, tied to this check-in.
  // No photo captured here by design — photos are taken later, at metadata check-in.
  const mpCaughtSnapshot = mudpuppyCaught, mpCountSnapshot = mudpuppyCount;
  if (mudpuppyCaught && mudpuppyCount > 0){
    for (let i = 0; i < mudpuppyCount; i++){
      await DB.addPendingMudpuppy({
        id: newId("MP"), trap_id: trap, checkin_ref_id: ref, site,
        catch_date: todayISO(), individual_index: i+1, total_in_catch: mudpuppyCount,
        photo_base64: null,
        sex: "", weight_g: "", svl_mm: "", swab_vial_id: "", pit_tag_id: "", tissue_vial_id: "",
        notes: "", submitted_at: nowISO(), updated_at: nowISO()
      });
    }
  }

  resetCheckinForm();
  buzz(40);
  trySyncAll();
  renderHome();
  $("ui-checkin-success").innerHTML = `
    <div class="success-panel">
      <div class="success-icon">LOGGED</div>
      <div class="success-title checkin-color">Trap ${trap} checked in</div>
      <div class="success-sub">Catch logged. Saved on this device${navigator.onLine?" and syncing now.":" — will sync once you're back online."}</div>
      <div class="success-card">
        <div class="success-row"><span>Soak time</span><span class="success-row-val">${fmtSoak(mins)}</span></div>
        <div class="success-row"><span>Species</span><span class="success-row-val">${currentSpecies.length} species | ${totalFish} fish</span></div>
        ${flagN>0 ? `<div class="success-row"><span>Flagged</span><span class="success-row-val" style="color:var(--amber-lt);">${flagN} entr${flagN===1?"y":"ies"}</span></div>` : ""}
        ${mpCaughtSnapshot && mpCountSnapshot>0 ? `<div class="success-row"><span>Mudpuppies</span><span class="success-row-val" style="color:var(--clay-lt);">${mpCountSnapshot} logged — record metadata in the Mudpuppies tab</span></div>` : ""}
      </div>
      <button class="action-btn primary-checkin" onclick="$('ui-checkin-success').innerHTML='';showScreen('screen-home');">Check next trap</button>
      <button class="action-btn secondary" onclick="$('ui-checkin-success').innerHTML='';showScreen('screen-home');switchMode('checkin');">Back to overview</button>
    </div>`;
}
window.submitCheckin = submitCheckin;
function slug(s){ return String(s).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,""); }
function resetCheckinForm(){
  currentSpecies = []; addedSpeciesNames.clear(); swIdx = 0; pendingPhoto = null;
  $("ai-banner-slot").innerHTML = "";
  renderSpeciesCards();
  $("gps-btn-checkin") && $("gps-btn-checkin").classList.remove("captured");
  $("checkin-notes").value = ""; $("observer-name").value = "";
  resetMudpuppyCheckinFields();
  resetBycatchCheckinFields();
}

// ============================================================
// CLEAR / ARCHIVE
// ============================================================
function showClearConfirm(){
  $("ui-clear-confirm").innerHTML = `
    <div class="confirm-box">
      <p>This archives all current deployments and catches on the server to a history tab, then clears both lists so you can start a fresh survey week. Requires an internet connection.</p>
      <div class="confirm-btns">
        <button class="confirm-yes" onclick="confirmClear()">Yes, clear and start fresh</button>
        <button class="confirm-no" onclick="$('ui-clear-confirm').innerHTML=''">Cancel</button>
      </div>
    </div>`;
}
window.showClearConfirm = showClearConfirm;
async function confirmClear(){
  $("ui-clear-confirm").innerHTML = "";
  if (!navigator.onLine){ toast("You're offline — connect to the internet to clear/archive the survey."); return; }
  try{
    const resp = await callServer("clear", {});
    if (resp && resp.ok){
      toast("Traps cleared and archived. Ready for new survey week.");
      await refreshFromServer();
      renderHome();
    } else {
      toast("Error clearing: " + (resp && resp.message ? resp.message : "unknown error"));
    }
  }catch(e){ toast("Error clearing: " + e.message); }
}
window.confirmClear = confirmClear;

// ============================================================
// SERVER COMMUNICATION (Google Apps Script backend)
// ============================================================
async function callServer(action, payload){
  if (!CFG.APPS_SCRIPT_URL || CFG.APPS_SCRIPT_URL.includes("PASTE_YOUR")){
    throw new Error("Apps Script URL not configured — edit config.js");
  }
  const resp = await fetch(CFG.APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" }, // avoids CORS preflight
    body: JSON.stringify({ action, payload })
  });
  return resp.json();
}
async function refreshFromServer(){
  try{
    const resp = await fetch(CFG.APPS_SCRIPT_URL + "?action=today");
    const data = await resp.json();
    if (data && data.ok){
      serverToday = { deployments: data.deployments || [], checkins: data.checkins || [] };
      await DB.cacheServer(serverToday);
    }
  }catch(e){ /* offline or unreachable — fall back to cache, handled at load */ }
}
async function refreshMudpuppiesFromServer(){
  try{
    const resp = await fetch(CFG.APPS_SCRIPT_URL + "?action=mudpuppies");
    const data = await resp.json();
    if (data && data.ok){
      await DB.cacheMudpuppies(data.mudpuppies || []);
    }
  }catch(e){ /* offline — fall back to cache */ }
}

async function trySyncAll(){
  if (!navigator.onLine) { await updateStatusBar(); return; }
  let networkDown = false;

  async function syncStore(getAll, addBack, remove, action, idKey){
    if (networkDown) return;
    const items = await getAll();
    for (const item of items){
      if (networkDown) break;
      // Back off on records that just failed for data reasons, so we don't
      // hammer the server every poll cycle with something that won't fix itself.
      if (item._syncError && item._lastAttempt && (Date.now() - new Date(item._lastAttempt).getTime()) < 30000){
        continue;
      }
      try{
        const resp = await callServer(action, item);
        if (resp && resp.ok){
          await remove(item[idKey]);
        } else {
          await addBack({ ...item, _syncError: (resp && resp.message) || "Server rejected this record.", _lastAttempt: nowISO() });
        }
      }catch(e){
        networkDown = true;
        await addBack({ ...item, _lastAttempt: nowISO() }); // network issue, not a data issue — no _syncError
      }
    }
  }

  await syncStore(DB.getPendingDeployments, DB.addPendingDeployment, DB.removePendingDeployment, "deploy", "ref_id");
  await syncStore(DB.getPendingCheckins,    DB.addPendingCheckin,    DB.removePendingCheckin,    "checkin", "ref_id");
  await syncStore(DB.getPendingMudpuppies,  DB.addPendingMudpuppy,   DB.removePendingMudpuppy,   "mudpuppySave", "id");

  if (!networkDown){
    await refreshFromServer();
    await refreshMudpuppiesFromServer();
    try{ localStorage.setItem("fishtrap_last_sync", Date.now().toString()); }catch(e){}
  }
  await updateStatusBar();
  await renderHome();
  if (document.getElementById("view-mudpuppies").style.display !== "none") renderMudpuppyList();
}

async function manualSync(){
  const btn = $("sync-now-btn");
  if (!btn || btn.classList.contains("syncing")) return;
  btn.classList.add("syncing"); btn.textContent = "Syncing...";
  await trySyncAll();
  btn.classList.remove("syncing"); btn.textContent = "Sync now";
}
window.manualSync = manualSync;

function timeAgo(ms){
  const diff = Math.max(0, Date.now() - ms);
  const mins = Math.floor(diff/60000);
  if (mins < 1) return "just now";
  if (mins < 60) return mins + "m ago";
  const hrs = Math.floor(mins/60);
  if (hrs < 24) return hrs + "h ago";
  return Math.floor(hrs/24) + "d ago";
}

async function renderSyncIssues(){
  const deps = await DB.getPendingDeployments();
  const checks = await DB.getPendingCheckins();
  const mudpuppies = await DB.getPendingMudpuppies();
  const issues = [
    ...deps.filter(d=>d._syncError).map(d=>({ type:"Deployment", label:`Trap ${d.trap_id}`, msg:d._syncError, action:"deploy", item:d })),
    ...checks.filter(c=>c._syncError).map(c=>({ type:"Check-in", label:`Trap ${c.trap_id}`, msg:c._syncError, action:"checkin", item:c })),
    ...mudpuppies.filter(m=>m._syncError).map(m=>({ type:"Mudpuppy", label:`Trap ${m.trap_id} #${m.individual_index}`, msg:m._syncError, action:"mudpuppySave", item:m }))
  ];
  const slot = $("sync-issues-slot");
  if (!issues.length){ slot.innerHTML = ""; return; }
  window._syncIssuesList = issues;
  slot.innerHTML = `<div class="sync-issues-banner">
    <div class="sync-issues-head"><span>${issues.length} record${issues.length>1?"s":""} need attention</span></div>
    ${issues.map((iss,idx)=>`<div class="sync-issue-item">${iss.type} — ${iss.label}<div class="msg">${iss.msg}</div>
      <button class="sync-issue-retry" onclick="retrySyncIssue(${idx})">Retry</button></div>`).join("")}
  </div>`;
}

async function retrySyncIssue(idx){
  const iss = (window._syncIssuesList || [])[idx];
  if (!iss) return;
  try{
    const resp = await callServer(iss.action, iss.item);
    if (resp && resp.ok){
      if (iss.action==="deploy") await DB.removePendingDeployment(iss.item.ref_id);
      else if (iss.action==="checkin") await DB.removePendingCheckin(iss.item.ref_id);
      else if (iss.action==="mudpuppySave") await DB.removePendingMudpuppy(iss.item.id);
      toast("Synced.");
    } else {
      toast("Still failing: " + ((resp && resp.message) || "unknown error"));
    }
  }catch(e){
    toast("Still offline or unreachable.");
  }
  await updateStatusBar();
  await renderHome();
}
window.retrySyncIssue = retrySyncIssue;

async function updateStatusBar(){
  const online = navigator.onLine;
  $("status-dot").className = "status-dot " + (online ? "online" : "offline");
  $("status-text").textContent = online ? "Online" : "Offline — your entries are saved on this device";
  const deps = await DB.getPendingDeployments();
  const checks = await DB.getPendingCheckins();
  const mudpuppies = await DB.getPendingMudpuppies();
  const n = deps.length + checks.length + mudpuppies.length;
  $("status-pending").textContent = n ? `${n} pending sync` : "";
  const bar = $("status-bar");
  bar.className = "status-bar " + (online ? "is-online" : "is-offline") + (n && online ? " has-pending" : "");

  let lastSync = null;
  try{ lastSync = localStorage.getItem("fishtrap_last_sync"); }catch(e){}
  $("last-synced-row").innerHTML = lastSync
    ? `Last synced ${timeAgo(parseInt(lastSync))}`
    : (online ? "" : "Not yet synced this session");

  await renderSyncIssues();
}

// Light haptic confirmation for key actions — useful outdoors when you're
// not watching the screen closely (cold hands, gloves, bright sun on glass).
function buzz(pattern){ if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch(e){} } }

// ============================================================
// SERVICE WORKER + OFFLINE BOOT
// ============================================================
if ("serviceWorker" in navigator){
  window.addEventListener("load", ()=>{
    navigator.serviceWorker.register("sw.js").catch(()=>{});
  });
}
window.addEventListener("online", ()=>{ trySyncAll(); });
window.addEventListener("offline", ()=>{ updateStatusBar(); });

async function init(){
  const ds = new Date().toDateString();
  const ts = nowTime();
  $("d-deploy-date").textContent = ds.slice(4);
  $("d-deploy-time").textContent = ts;

  buildTrapDropdown();
  buildSiteChips();
  buildSheetTabs();

  const cached = await DB.getServerCache();
  if (cached) serverToday = cached;

  await updateStatusBar();
  await renderHome();

  if (navigator.onLine){
    await refreshFromServer();
    await refreshMudpuppiesFromServer();
    await trySyncAll();
  }
  setInterval(()=>{ if (navigator.onLine) trySyncAll(); }, CFG.POLL_INTERVAL_MS || 20000);
}
document.addEventListener("DOMContentLoaded", init);
