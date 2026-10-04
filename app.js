// ============================================================
// Fish Trap Survey: offline-first PWA
// Fish bycatch: user selects species, enters count/length/weight,
// uploads photos. Photos go to a dedicated Drive folder.
// No iNaturalist AI: species selected manually from list.
// Drive folder for bycatch photos: 11MutIp3rVTGF8vrqAvL4f0_Rez_0AmuB
// ============================================================

const CFG = window.APP_CONFIG;

// Bycatch state
let currentSpecies = [];      // [{id, name, sci, count, length_cm, weight_g, flagged, swatch, photos:[{dataUrl,base64}]}]
let addedSpeciesNames = new Set();
let swIdx = 0;
const SWATCHES = ["sw-a","sw-b","sw-c","sw-d"];
let currentTab = "all";
let searchQ = "";

// Active photo-add target
let _photoTargetId = null;    // species card id waiting for a photo

let serverToday = { deployments: [], checkins: [] };
let _syncInFlight = null;
let _syncAgain = false;
let _lastSyncError = "";
let _checkinSubmitting = false;
let _checkinReceipt = null;

// ── helpers ────────────────────────────────────────────────
function pad(n){ return String(n).padStart(2,"0"); }
function dateISO(d=new Date()){ return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate()); }
function todayISO(){ return dateISO(); }
function nowTime(d=new Date()){ return pad(d.getHours())+":"+pad(d.getMinutes()); }
function setDateTimeInputs(dateId,timeId,d=new Date()){
  const dateInput=$(dateId),timeInput=$(timeId);
  if(dateInput) dateInput.value=dateISO(d);
  if(timeInput) timeInput.value=nowTime(d);
}
function parseLocalDateTime(dateStr,timeStr){
  const dateMatch=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr||""));
  const timeMatch=/^(\d{2}):(\d{2})$/.exec(String(timeStr||""));
  if(!dateMatch||!timeMatch) return null;
  const [,year,month,day]=dateMatch.map(Number),[,hour,minute]=timeMatch.map(Number);
  const d=new Date(year,month-1,day,hour,minute,0,0);
  if(d.getFullYear()!==year||d.getMonth()!==month-1||d.getDate()!==day||d.getHours()!==hour||d.getMinutes()!==minute) return null;
  return d;
}
function nowISO(){ return new Date().toISOString(); }
function newId(p){ return p+"-"+Date.now()+"-"+Math.random().toString(36).slice(2,7); }
function $(id){ return document.getElementById(id); }
function slug(s){ return String(s).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,""); }
function escapeAttr(s){ return String(s).replace(/'/g,"\\'"); }
function escapeHtml(s){ return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }
function toast(msg,ms=3200){
  const el=document.createElement("div"); el.className="toast"; el.textContent=msg;
  $("toast-slot").appendChild(el); setTimeout(()=>el.remove(),ms);
}
function fileToDataUrl(file){
  return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(file); });
}
function soakMins(deployDate,deployTime,checkDate,checkTime){
  const start=parseLocalDateTime(deployDate,deployTime),end=parseLocalDateTime(checkDate,checkTime);
  if(!start||!end) return null;
  return Math.round((end.getTime()-start.getTime())/60000);
}
function fmtSoak(mins){
  if(mins===null||mins===undefined||isNaN(mins)) return "--";
  const abs=Math.abs(mins),h=Math.floor(abs/60),m=abs%60;
  const text=h===0?m+"m":h+"h "+pad(m)+"m";
  return mins<0?"Starts in "+text:text;
}
function elapsedMins(deployDate,deployTime,now=new Date()){
  const start=parseLocalDateTime(deployDate,deployTime);
  if(!start) return null;
  return Math.round((now.getTime()-start.getTime())/60000);
}
function buzz(pat){ if(navigator.vibrate){ try{ navigator.vibrate(pat); }catch(e){} } }

// ── theme toggle ───────────────────────────────────────────
function toggleTheme(){
  const html=document.documentElement;
  const isDay=html.getAttribute("data-theme")==="day";
  html.setAttribute("data-theme", isDay?"night":"day");
  $("theme-icon").textContent  = isDay?"☀":"☽";
  $("theme-label").textContent = isDay?"Day mode":"Night mode";
  try{ localStorage.setItem("fishtrap_theme", isDay?"night":"day"); }catch(e){}
}
window.toggleTheme=toggleTheme;

// ── screen nav ─────────────────────────────────────────────
function showScreen(id){
  document.querySelectorAll(".screen").forEach(s=>s.classList.remove("active"));
  const el=$(id); if(el){ el.classList.add("active"); window.scrollTo(0,0); }
}
function switchMode(mode){
  $("pill-deploy").className    ="mode-pill"+(mode==="deploy"    ?" active-deploy":"");
  $("pill-checkin").className   ="mode-pill"+(mode==="checkin"   ?" active-checkin":"");
  $("pill-mudpuppies").className="mode-pill"+(mode==="mudpuppies"?" active-mudpuppy":"");
  $("view-deploy").style.display     =mode==="deploy"     ?"":"none";
  $("view-checkin").style.display    =mode==="checkin"    ?"":"none";
  $("view-mudpuppies").style.display =mode==="mudpuppies" ?"":"none";
  if(mode==="mudpuppies") renderMudpuppyList();
}
window.showScreen=showScreen; window.switchMode=switchMode;

// ── trap dropdown ──────────────────────────────────────────
function buildTrapDropdown(){
  const dd=$("dd-deploy-trap"); dd.innerHTML="";
  window.TRAP_IDS.forEach(id=>{
    const opt=document.createElement("div");
    opt.className="select-option"; opt.textContent=id; opt.dataset.val=id;
    opt.onclick=()=>selectTrap(id); dd.appendChild(opt);
  });
}
function selectTrap(val){
  document.querySelectorAll("#dd-deploy-trap .select-option").forEach(o=>o.classList.toggle("selected",o.dataset.val===val));
  $("val-deploy-trap").textContent=val;
  $("dd-deploy-trap").classList.remove("open");
  $("trigger-deploy-trap").classList.remove("open");
  state.deployTrap=val;
}
function toggleDd(ddId,trigger){
  const dd=$(ddId),isOpen=dd.classList.contains("open");
  document.querySelectorAll(".select-dropdown").forEach(d=>d.classList.remove("open"));
  document.querySelectorAll(".select-trigger").forEach(t=>t.classList.remove("open"));
  if(!isOpen){ dd.classList.add("open"); trigger.classList.add("open"); }
}
document.addEventListener("click",(e)=>{
  if(!e.target.closest(".custom-select")){
    document.querySelectorAll(".select-dropdown").forEach(d=>d.classList.remove("open"));
    document.querySelectorAll(".select-trigger").forEach(t=>t.classList.remove("open"));
  }
});
window.toggleDd=toggleDd;

// ── site chips ─────────────────────────────────────────────
function buildSiteChips(){
  const wrap=$("deploy-site-chips"); wrap.innerHTML="";
  window.SURVEY_SITES.forEach((s,i)=>{
    const chip=document.createElement("div");
    chip.className="chip"+(i===3?" sel-water":"");
    chip.textContent=s;
    chip.onclick=()=>{ wrap.querySelectorAll(".chip").forEach(c=>c.classList.remove("sel-water")); chip.classList.add("sel-water"); state.deploySite=s; };
    wrap.appendChild(chip);
  });
  state.deploySite=window.SURVEY_SITES[3];
}

// ── form state ─────────────────────────────────────────────
const state={
  deployTrap:"",deploySite:"",deployGpsLat:"",deployGpsLng:"",
  checkinTrapId:"",checkinDeployRefId:"",checkinDeployDate:"",checkinDeployTime:"",checkinGpsLat:"",checkinGpsLng:"",
  condWeather:"sunny"
};

// ── GPS ────────────────────────────────────────────────────
const GPS_ACCURACY_WARN_M=25;
function captureGPS(scope){
  const btn=$("gps-btn-"+scope),ico=$("gps-ico-"+scope);
  btn.classList.remove("captured","low-accuracy");
  $("gps-main-"+scope).textContent="Getting location...";
  $("gps-sub-"+scope).textContent="Contacting GPS";
  $("gps-tick-"+scope).style.opacity="0";
  ico.classList.add("pulsing");
  if(!navigator.geolocation){ $("gps-main-"+scope).textContent="Geolocation not supported"; ico.classList.remove("pulsing"); return; }
  navigator.geolocation.getCurrentPosition(
    (pos)=>{
      const lat=pos.coords.latitude.toFixed(6),lng=pos.coords.longitude.toFixed(6),acc=Math.round(pos.coords.accuracy);
      const low=acc>GPS_ACCURACY_WARN_M;
      btn.classList.toggle("captured",!low); btn.classList.toggle("low-accuracy",low);
      $("gps-main-"+scope).textContent=lat+", "+lng;
      $("gps-sub-"+scope).textContent=low?"+/-"+acc+"m: low accuracy, tap to retry":"+/-"+acc+"m  tap to refresh";
      const tick=$("gps-tick-"+scope); tick.textContent=low?"!":"OK"; tick.style.opacity="1";
      ico.classList.remove("pulsing");
      if(scope==="deploy"){state.deployGpsLat=lat;state.deployGpsLng=lng;}
      else{state.checkinGpsLat=lat;state.checkinGpsLng=lng;}
    },
    (err)=>{
      const msgs={1:"Permission denied.",2:"Position unavailable.",3:"Timed out."};
      $("gps-main-"+scope).textContent=msgs[err.code]||"Error"; $("gps-sub-"+scope).textContent="Tap to try again";
      ico.classList.remove("pulsing");
    },
    {enableHighAccuracy:true,timeout:15000,maximumAge:0}
  );
}
window.captureGPS=captureGPS;

function pickCond(el,group){
  el.closest(".cond-tap-row").querySelectorAll(".cond-tap").forEach(t=>t.classList.remove("active"));
  el.classList.add("active");
  state["cond"+group.charAt(0).toUpperCase()+group.slice(1)]=el.dataset.val;
}
window.pickCond=pickCond;

// ============================================================
// SPECIES PICKER SHEET
// ============================================================
function buildSheetTabs(){
  const tabs=[["all","All"],["warmwater","Warmwater"],["greatlakes","Great Lakes"],
              ["invasive","Invasive"],["minnow","Minnows"],["other","Other"]];
  const wrap=$("sheet-tabs"); wrap.innerHTML="";
  tabs.forEach(([key,label])=>{
    const t=document.createElement("div");
    t.className="sheet-tab"+(key==="all"?" active":"");
    t.textContent=label;
    t.onclick=()=>{ currentTab=key; wrap.querySelectorAll(".sheet-tab").forEach(x=>x.classList.remove("active")); t.classList.add("active"); renderSheet(); };
    wrap.appendChild(t);
  });
}
function openSheet(){ renderSheet(); $("sheet-overlay").classList.add("open"); $("sheet-search").value=""; searchQ=""; }
function closeSheet(){ $("sheet-overlay").classList.remove("open"); }
function overlayClick(e){ if(e.target===$("sheet-overlay")) closeSheet(); }
function filterSheet(){ searchQ=$("sheet-search").value.toLowerCase(); renderSheet(); }
window.openSheet=openSheet; window.closeSheet=closeSheet; window.overlayClick=overlayClick; window.filterSheet=filterSheet;

function renderSheet(){
  const list=$("sheet-list"); list.innerHTML="";
  const cats=currentTab==="all"?["warmwater","greatlakes","invasive","minnow","other"]:[currentTab];
  let any=false;
  cats.forEach(cat=>{
    const items=window.SPECIES_DATA[cat].filter(([name,sci])=>{
      if(!searchQ) return true;
      return name.toLowerCase().includes(searchQ)||sci.toLowerCase().includes(searchQ);
    });
    if(!items.length) return;
    any=true;
    if(currentTab==="all"){
      const gl=document.createElement("div"); gl.className="sheet-group-lbl"; gl.textContent=window.CAT_LABELS[cat];
      list.appendChild(gl);
    }
    items.forEach(([name,sci])=>{
      const isSel=addedSpeciesNames.has(name);
      const row=document.createElement("div");
      row.className="sheet-item"+(isSel?" sel":"");
      row.innerHTML=`<div class="sheet-item-dot"></div><div class="sheet-item-info"><div class="sheet-item-name">${name}</div>${sci?`<div class="sheet-item-sci">${sci}</div>`:""}</div><span class="sheet-item-check">✓</span>`;
      row.onclick=()=>toggleSpecies(name,sci);
      list.appendChild(row);
    });
  });
  if(!any){
    const e=document.createElement("div");
    e.style.cssText="padding:2rem 1rem;text-align:center;color:var(--ink4);font-size:0.9rem;";
    e.textContent=`No results for "${searchQ}"`;
    list.appendChild(e);
  }
}

// ── species cards ──────────────────────────────────────────
function toggleSpecies(name,sci){
  if(addedSpeciesNames.has(name)){
    addedSpeciesNames.delete(name);
    currentSpecies=currentSpecies.filter(c=>c.name!==name);
  } else {
    addedSpeciesNames.add(name);
    const sw=SWATCHES[swIdx%SWATCHES.length]; swIdx++;
    currentSpecies.push({ id:newId("SP"), name, sci, count:1,
      length_cm:"", weight_g:"", flagged:false, swatch:sw, photos:[] });
  }
  renderSpeciesCards();
  if($("sheet-overlay").classList.contains("open")) renderSheet();
}
window.toggleSpecies=toggleSpecies;

function renderSpeciesCards(){
  const wrap=$("checkin-sp-list"); wrap.innerHTML="";
  currentSpecies.forEach(card=>{
    const el=document.createElement("div");
    el.className="sp-card"+(card.count===0?" zero-warn":"");

    // Thumbnail: first photo if any
    const firstPhoto=card.photos[0];
    const swatchStyle=firstPhoto?`style="background-image:url('${firstPhoto.dataUrl}');background-size:cover;"`:""

    // Photo thumbnails strip
    const thumbsHtml=card.photos.map((p,pi)=>
      `<div class="sp-photo-thumb" style="background-image:url('${p.dataUrl}')" title="Photo ${pi+1}"></div>`
    ).join("");

    el.innerHTML=`
      <div class="sp-row">
        <div class="sp-swatch ${card.swatch}" ${swatchStyle}>${firstPhoto?"":"F"}</div>
        <div class="sp-info">
          <div class="sp-name">${card.name}</div>
          ${card.sci?`<div class="sp-sci">${card.sci}</div>`:""}
          <div class="sp-metrics">
            <div class="sp-metric">
              <label>Count</label>
              <input type="number" inputmode="numeric" value="${card.count}"
                onchange="updateField('${card.id}','count',this.value)" placeholder="1">
            </div>
            <div class="sp-metric">
              <label>Length (cm)</label>
              <input type="number" inputmode="decimal" value="${card.length_cm}"
                onchange="updateField('${card.id}','length_cm',this.value)" placeholder="Optional">
            </div>
            <div class="sp-metric">
              <label>Weight (g)</label>
              <input type="number" inputmode="decimal" value="${card.weight_g}"
                onchange="updateField('${card.id}','weight_g',this.value)" placeholder="Optional">
            </div>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:center;gap:.18rem;flex-shrink:0;">
          <button class="sp-flag${card.flagged?" flagged":""}" onclick="toggleFlag('${card.id}')">!</button>
          <button class="sp-del" onclick="removeCard('${card.id}')">✕</button>
        </div>
      </div>
      <div class="sp-photo-row">
        <button class="sp-photo-btn" onclick="triggerSpeciesPhoto('${card.id}')">
          📷 ${card.photos.length>0?`Add photo (${card.photos.length} saved)`:"Photograph fish"}
        </button>
      </div>
      ${card.photos.length>0?`<div class="sp-photo-thumbs">${thumbsHtml}</div>`:""}`;
    wrap.appendChild(el);
  });
  syncTotal();
  renderRecentSpecies();
}

function updateField(id,field,val){
  const card=currentSpecies.find(c=>c.id===id); if(!card) return;
  if(field==="count") card.count=Math.max(0,parseInt(val)||0);
  else card[field]=val;
  syncTotal();
}
function toggleFlag(id){
  const card=currentSpecies.find(c=>c.id===id); if(card){ card.flagged=!card.flagged; renderSpeciesCards(); }
}
function removeCard(id){
  const card=currentSpecies.find(c=>c.id===id);
  if(card) addedSpeciesNames.delete(card.name);
  currentSpecies=currentSpecies.filter(c=>c.id!==id);
  renderSpeciesCards();
  if($("sheet-overlay").classList.contains("open")) renderSheet();
}
window.updateField=updateField; window.toggleFlag=toggleFlag; window.removeCard=removeCard;

function syncTotal(){
  const total=currentSpecies.reduce((a,c)=>a+(parseInt(c.count)||0),0);
  $("checkin-total-val").textContent=`${total} fish | ${currentSpecies.length} species`;
}

// ── recently used ──────────────────────────────────────────
const RECENT_SP_KEY="fishtrap_recent_species";
function getRecentSpecies(){ try{ return JSON.parse(localStorage.getItem(RECENT_SP_KEY)||"[]"); }catch(e){ return []; } }
function addToRecentSpecies(cards){
  let recent=getRecentSpecies();
  cards.forEach(c=>{ recent=recent.filter(r=>r.name!==c.name); recent.unshift({name:c.name,sci:c.sci}); });
  recent=recent.slice(0,8);
  try{ localStorage.setItem(RECENT_SP_KEY,JSON.stringify(recent)); }catch(e){}
}
function renderRecentSpecies(){
  const slot=$("recent-sp-slot");
  const recent=getRecentSpecies().filter(r=>!addedSpeciesNames.has(r.name));
  if(!recent.length){ slot.innerHTML=""; return; }
  slot.innerHTML=`<div class="recent-sp-row">${recent.map(r=>
    `<div class="recent-sp-chip" onclick="toggleSpecies('${escapeAttr(r.name)}','${escapeAttr(r.sci||"")}')">
      ${r.name}</div>`
  ).join("")}</div>`;
}

// ── photo capture per species card ─────────────────────────
function triggerSpeciesPhoto(cardId){
  _photoTargetId=cardId;
  $("species-photo-input").click();
}
window.triggerSpeciesPhoto=triggerSpeciesPhoto;

// ============================================================
// MUDPUPPY toggle
// ============================================================
let mudpuppyCaught=false,mudpuppyCount=1;
function setMudpuppyCaught(yes){
  mudpuppyCaught=yes;
  $("mp-tap-no").classList.toggle("active",!yes);
  $("mp-tap-yes").classList.toggle("active",yes);
  $("mudpuppy-detail").style.display=yes?"":"none";
}
function changeMudpuppyCount(delta){ mudpuppyCount=Math.max(1,mudpuppyCount+delta); $("mp-count-val").textContent=mudpuppyCount; }
window.setMudpuppyCaught=setMudpuppyCaught; window.changeMudpuppyCount=changeMudpuppyCount;
function resetMudpuppyCheckinFields(){
  mudpuppyCaught=false; mudpuppyCount=1;
  $("mp-tap-no").classList.add("active"); $("mp-tap-yes").classList.remove("active");
  $("mudpuppy-detail").style.display="none"; $("mp-count-val").textContent="1";
}

// ============================================================
// MUDPUPPY RECORDS
// ============================================================
async function mergedMudpuppies(){
  const pending=await DB.getPendingMudpuppies();
  const cached=await DB.getMudpuppyCache()||[];
  const byId={};
  cached.forEach(m=>byId[m.id]={...m,_pending:false});
  pending.forEach(m=>byId[m.id]={...m,_pending:true});
  return Object.values(byId).sort((a,b)=>String(b.submitted_at||"").localeCompare(String(a.submitted_at||"")));
}
function isMpComplete(m){ return !!(m.sex&&m.weight_g!==""&&m.weight_g!==undefined&&m.svl_mm!==""&&m.svl_mm!==undefined); }

async function renderMudpuppyList(){
  const list=await mergedMudpuppies(),el=$("ui-mudpuppy-list");
  if(!list.length){ el.innerHTML=`<div class="empty-state"><div class="empty-state-text">No mudpuppies logged yet.<br>Added from the Check-in form.</div></div>`; return; }
  el.innerHTML="";
  list.forEach(m=>{
    const card=document.createElement("div"); card.className="mp-card"; card.onclick=()=>openMudpuppyDetail(m.id);
    const complete=isMpComplete(m);
    card.innerHTML=`
      <div class="thumb" style="${m.photo_url?`background-image:url('${m.photo_url}')`:(m.photo_base64?`background-image:url('data:image/jpeg;base64,${m.photo_base64}')`:"")}"></div>
      <div class="mp-card-info">
        <div class="mp-card-title">Trap ${m.trap_id} · #${m.individual_index} of ${m.total_in_catch}</div>
        <div class="mp-card-meta">${m.catch_date||""} ${m.site?"· "+m.site:""}${m.sex?" · "+m.sex:""}${m.weight_g?" · "+m.weight_g+"g":""}${m.glochidia_present==="Yes"?" · glochidia+":""}</div>
      </div>
      ${complete?`<div class="mp-badge-complete">Complete</div>`:`<div class="mp-badge-incomplete">Needs metadata</div>`}
      ${m._pending?`<div class="trap-badge-pending">sync pending</div>`:""}`;
    el.appendChild(card);
  });
}
window.renderMudpuppyList=renderMudpuppyList;

async function openMudpuppyDetail(id){
  const list=await mergedMudpuppies(),m=list.find(x=>x.id===id);
  if(!m){ toast("Record not found."); return; }
  renderMudpuppyDetailForm(m); showScreen("screen-mudpuppy-detail");
}
window.openMudpuppyDetail=openMudpuppyDetail;

function renderMudpuppyDetailForm(m){
  const photoSrc=m.photo_url||(m.photo_base64?`data:image/jpeg;base64,${m.photo_base64}`:null);
  _mpDetailNewPhoto=null;
  const el=$("ui-mudpuppy-detail");
  el.innerHTML=`
    <div class="hero mudpuppy" style="margin-top:.2rem;">
      <div class="hero-eyebrow">Mudpuppy</div>
      <div class="hero-title">Trap ${m.trap_id} · #${m.individual_index} of ${m.total_in_catch}</div>
      <div class="hero-sub">${m.catch_date||""} ${m.site?"· "+m.site:""}</div>
    </div>
    <div class="field-block" style="margin-top:.85rem;">
      <span class="sec-label">Photograph</span>
      <div class="mp-detail-photo" id="mp-detail-photo" style="cursor:pointer;${photoSrc?`background-image:url('${photoSrc}')`:""}" onclick="triggerMpDetailPhoto()">${photoSrc?"":"Tap to photograph"}</div>
      <p style="font-size:0.9rem;color:var(--ink4);margin-top:.38rem;line-height:1.5;">Taken at processing time, not at check-in.</p>
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
        <div class="cond-tap" id="gl-tap-no"  data-val="No">No</div>
        <div class="cond-tap" id="gl-tap-yes" data-val="Yes">Yes</div>
        <div class="cond-tap" id="gl-tap-na"  data-val="Not examined">Not examined</div>
      </div>
      <div id="glochidia-count-wrap" style="display:none;margin-top:.55rem;">
        <span class="sec-label">Approximate Count</span>
        <div class="unit-input-row"><input type="number" inputmode="numeric" id="mp-glochidia-count" value="${m.glochidia_count||""}" placeholder="0"><span class="unit">glochidia</span></div>
      </div>
    </div>
    <div class="divider"></div>
    <div class="field-block">
      ${correctionButton("mudpuppy",m.id)}${deleteRecordButton("mudpuppy",m.id)}<span class="sec-label">Swab Vial ID</span>
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
      <textarea class="notes-ta" id="mp-notes" rows="2" placeholder="Recapture status, body condition, injuries...">${m.notes||""}</textarea>
    </div>
    <div class="submit-wrap">
      <button class="primary-btn" style="background:var(--clay);" onclick="saveMudpuppyDetail('${m.id}')">Save Metadata</button>
    </div>
    <div id="mp-save-toast-slot"></div>`;

  const sexRow=el.querySelector(".sex-chip-row");
  sexRow.querySelectorAll(".sex-chip").forEach(chip=>{
    chip.classList.toggle("active",chip.dataset.val===m.sex);
    chip.onclick=()=>{ sexRow.querySelectorAll(".sex-chip").forEach(c=>c.classList.remove("active")); chip.classList.add("active"); };
  });
  const glTaps=[$("gl-tap-no"),$("gl-tap-yes"),$("gl-tap-na")];
  const currentGl=m.glochidia_present||"";
  glTaps.forEach(t=>t.classList.toggle("active",t.dataset.val===currentGl));
  $("glochidia-count-wrap").style.display=currentGl==="Yes"?"":"none";
  glTaps.forEach(t=>{ t.onclick=()=>{ glTaps.forEach(x=>x.classList.remove("active")); t.classList.add("active"); $("glochidia-count-wrap").style.display=t.dataset.val==="Yes"?"":"none"; }; });
}

async function saveMudpuppyDetail(id){
  if(_dataMaintenance){ toast("Please wait for record cleanup to finish."); return; }
  const list=await mergedMudpuppies(),existing=list.find(x=>x.id===id)||{};
  const sexChip=document.querySelector("#ui-mudpuppy-detail .sex-chip.active");
  const glChip=document.querySelector("#ui-mudpuppy-detail .cond-tap.active[id^='gl-tap-']");
  const updated={
    ...existing,
    sex:sexChip?sexChip.dataset.val:"",
    weight_g:$("mp-weight").value, svl_mm:$("mp-svl").value,
    glochidia_present:glChip?glChip.dataset.val:"",
    glochidia_count:glChip&&glChip.dataset.val==="Yes"?$("mp-glochidia-count").value:"",
    swab_vial_id:$("mp-swab").value.trim(), pit_tag_id:$("mp-pit").value.trim(),
    tissue_vial_id:$("mp-tissue").value.trim(), notes:$("mp-notes").value.trim(),
    updated_at:nowISO()
  };
  if(_mpDetailNewPhoto) updated.photo_base64=_mpDetailNewPhoto.base64;
  delete updated._pending;
  await DB.addPendingMudpuppy(updated); _mpDetailNewPhoto=null; buzz(40);
  $("mp-save-toast-slot").innerHTML=`<div class="mp-save-toast">Saved${navigator.onLine?": syncing now":" on device: syncs when online"}.</div>`;
  trySyncAll();
}
window.saveMudpuppyDetail=saveMudpuppyDetail;

let _mpDetailNewPhoto=null;
function triggerMpDetailPhoto(){ $("mp-detail-photo-input").click(); }
window.triggerMpDetailPhoto=triggerMpDetailPhoto;

// ============================================================
// MERGED DATA
// ============================================================
async function mergedDeployments(){
  const pending=await DB.getPendingDeployments(),server=serverToday.deployments||[];
  const byRef={};
  const key=d=>d.ref_id||`${d.trap_id}:${d.deploy_date||""}:${d.deploy_time||""}`;
  server.forEach(d=>byRef[key(d)]={...d,_pending:false});
  pending.forEach(d=>byRef[key(d)]={...d,_pending:true});
  return Object.values(byRef).sort((a,b)=>`${b.deploy_date||""} ${b.deploy_time||""}`.localeCompare(`${a.deploy_date||""} ${a.deploy_time||""}`));
}
async function mergedCheckins(){
  const pending=await DB.getPendingCheckins(),server=serverToday.checkins||[];
  const byRef={};
  const key=c=>c.ref_id||`${c.trap_id}:${c.checkin_date||""}:${c.checkin_time||""}`;
  server.forEach(c=>byRef[key(c)]={...c,_pending:false});
  pending.forEach(c=>byRef[key(c)]={...c,_pending:true});
  return Object.values(byRef).sort((a,b)=>`${b.checkin_date||""} ${b.checkin_time||""}`.localeCompare(`${a.checkin_date||""} ${a.checkin_time||""}`));
}

// ============================================================
// HOME
// ============================================================
function checkinBelongsTo(c,d){
  return c.deployment_ref_id ? c.deployment_ref_id===d.ref_id : c.trap_id===d.trap_id && `${c.checkin_date||""} ${c.checkin_time||""}`>=`${d.deploy_date||""} ${d.deploy_time||""}`;
}
function readSiteMeasurements(){
  const result={};
  for(const [id,key,label] of [["air-temp-input","air_temp_c","Air temperature"],["temp-input","water_temp_c","Water temperature"],["water-ph-input","water_ph","Water pH"]]){
    const input=$(id),raw=input.value.trim();
    if(input.validity?.badInput) throw new Error(`${label}: enter a valid number.`);
    if(raw===""){ result[key]=""; continue; }
    const value=Number(raw);
    if(!Number.isFinite(value)) throw new Error(`${label}: enter a valid number.`);
    if(key==="water_ph"&&(value<0||value>14)) throw new Error("Water pH must be between 0 and 14.");
    result[key]=value;
  }
  return result;
}
function measurementHistoryHtml(c){
  return [["air_temp_c","Air temperature"," °C"],["water_temp_c","Water temperature"," °C"],["water_ph","Water pH",""]].map(([key,label,unit])=>`<p>${label}: ${c[key]!==""&&c[key]!=null?escapeHtml(String(c[key]))+unit:"Not recorded"}</p>`).join("");
}
function checkinHistoryHtml(c){
  const e=escapeHtml;
  const species=Array.isArray(c.species)?c.species:[];
  const rows=species.map(sp=>`<div class="success-row"><span>${e(sp.species||"")} ${sp.sci||sp.sci_name?`(${e(sp.sci||sp.sci_name)})`:""}</span><span>${e(String(sp.count||0))} caught${sp.length_cm?` · ${e(String(sp.length_cm))} cm`:""}${sp.weight_g?` · ${e(String(sp.weight_g))} g`:""}</span></div>`).join("");
  return `<details class="success-card" style="margin:.65rem"><summary>${e(c.checkin_date||"")} ${e(c.checkin_time||"")} · View catch details</summary>${rows||"<p>No fish species recorded.</p>"}<p>Mudpuppies: ${e(String(c.mudpuppy_count||0))}</p>${c.observer?`<p>Observer: ${e(c.observer)}</p>`:""}${c.notes?`<p>Notes: ${e(c.notes)}</p>`:""}${measurementHistoryHtml(c)}<p>Sampling interval: ${c.interval_mins==null?"Not recorded":escapeHtml(String(c.interval_mins))+" min"} (${c.interval_basis==="previous_check"?"since previous check":"since deployment"})</p><p>Total time since deployment: ${e(fmtSoak(c.soak_mins))}</p>${correctionButton("checkin",c.ref_id)}${deleteRecordButton("checkin",c.ref_id)}</details>`;
}

async function renderHome(){
  const deps=await mergedDeployments(),checks=await mergedCheckins();
  const isDone=d=>checks.some(c=>checkinBelongsTo(c,d)&&c.checkin_date===todayISO());
  const pendingCount=(await DB.getPendingDeployments()).length+(await DB.getPendingCheckins()).length+(await DB.getPendingMudpuppies()).length;
  const checked=deps.filter(isDone).length;
  $("daily-dashboard").innerHTML=[['Deployed',deps.length],['Checked today',checked],['To check today',deps.length-checked],['Pending upload',pendingCount]].map(([label,n])=>`<div><strong>${n}</strong><span>${label}</span></div>`).join('');
  const dl=$("ui-deploy-list");
  if(!deps.length){
    dl.innerHTML=`<div class="empty-state"><div class="empty-state-text">No traps in this survey yet.<br>Tap "+ Deploy new trap" to begin.</div></div>`;
  } else {
    dl.innerHTML="";
    deps.forEach(d=>{
      const done=isDone(d),em=elapsedMins(d.deploy_date,d.deploy_time);
      const card=document.createElement("div"); card.className="trap-card "+(done?"st-done":"st-deployed");
      card.onclick=()=>{ state.viewTrap=d.trap_id; renderDeployDetail(d.ref_id); showScreen("screen-deploy-detail"); };
      card.innerHTML=`<div class="trap-card-inner">
        <div class="trap-status-dot ${done?"dot-done":"dot-deployed"}"></div>
        <div class="trap-card-info">
          <div class="trap-card-id">Trap ${d.trap_id}</div>
          <div class="trap-card-meta">${d.site||""} | ${d.deploy_date||""} ${d.deploy_time||""}${d.gps_lat?` | ${d.gps_lat}, ${d.gps_lng}`:""}</div>
        </div>
        ${done?`<div class="trap-badge-done">Checked today</div>`:`<div class="trap-badge-soak">${em===null?"Awaiting check-in":fmtSoak(em)}</div>`}
        ${d._pending?`<div class="trap-badge-pending">sync pending</div>`:""}
        <div class="trap-card-arrow">›</div>
      </div>`;
      dl.appendChild(card);
    });
  }
  const cl=$("ui-checkin-list"),pendingTraps=deps;
  if(!pendingTraps.length){
    cl.innerHTML=`<div class="empty-state"><div class="empty-state-text">${deps.length?"All deployed traps have been checked in.":"No deployments yet: switch to Deploy first."}</div></div>`;
  } else {
    cl.innerHTML="";
    pendingTraps.forEach(d=>{
      const em=elapsedMins(d.deploy_date,d.deploy_time);
      const card=document.createElement("div"); card.className="trap-card st-deployed";
      card.onclick=()=>startCheckin(d.ref_id);
      card.innerHTML=`<div class="trap-card-inner">
        <div class="trap-status-dot dot-deployed"></div>
        <div class="trap-card-info">
          <div class="trap-card-id">Trap ${d.trap_id}</div>
          <div class="trap-card-meta">${d.site||""} | deployed ${d.deploy_date||""} ${d.deploy_time||""}${d.gps_lat?` | ${d.gps_lat}, ${d.gps_lng}`:""}</div>
        </div>
        <div class="trap-badge-soak">${em===null?"Ready":fmtSoak(em)}</div>
        <div class="trap-card-arrow">›</div>
      </div>`;
      cl.appendChild(card);
    });
  }
  const dn=$("ui-done-list");
  if(!checks.length){ dn.innerHTML=""; } else {
    const mudpuppies=await mergedMudpuppies();
    dn.innerHTML=`<span class="trap-list-lbl" style="margin-top:.55rem;display:block;">Completed check-ins</span>`;
    checks.forEach(c=>{
      const mpForTrap=mudpuppies.filter(m=>m.checkin_ref_id===c.ref_id);
      const card=document.createElement("div"); card.className="trap-card"; card.style.opacity="1";
      card.innerHTML=`<div class="trap-card-inner">
        <div class="trap-status-dot dot-done"></div>
        <div class="trap-card-info"><div class="trap-card-id">Trap ${c.trap_id}</div>
          <div class="trap-card-meta">Check-in ${c.checkin_date||""} ${c.checkin_time||""}${c._pending?": upload pending":""}</div></div>
        ${mpForTrap.length?`<div class="trap-badge-mudpuppy" onclick="event.stopPropagation();switchMode('mudpuppies');showScreen('screen-home');">${mpForTrap.length} mudpuppy${mpForTrap.length>1?"s":""}</div>`:""}
        <div class="trap-badge-done">Done</div>
      </div>`;
      card.insertAdjacentHTML("beforeend", checkinHistoryHtml(c));
      dn.appendChild(card);
    });
  }
}

async function renderDeployDetail(deployRefId){
  const deps=await mergedDeployments(),dep=deps.find(d=>d.ref_id===deployRefId)||deps.find(d=>d.trap_id===deployRefId);
  const el=$("ui-deploy-detail");
  if(!dep){ el.innerHTML="<p>Trap not found.</p>"; return; }
  const checks=await mergedCheckins();
  const trapChecks=checks.filter(c=>checkinBelongsTo(c,dep));
  const em=elapsedMins(dep.deploy_date,dep.deploy_time);
  el.innerHTML=`
    <div class="hero deploy" style="margin-top:.2rem;">
      <div class="hero-eyebrow">Deployed</div>
      <div class="hero-title">Trap ${dep.trap_id}</div>
      <div class="hero-sub">${dep.site||""} | ${dep.deploy_date||""} | ${trapChecks.length} check-ins recorded</div>
    </div>
    <div class="field-block" style="margin-top:.85rem;">
      <div class="soak-card">
        <div class="soak-icon">SOAK</div>
        <div class="soak-info"><div class="soak-lbl">Time in water</div><div class="soak-val">${em===null?"Deployment date/time unavailable":em<0?`Scheduled for ${dep.deploy_date} ${dep.deploy_time}`:`Set ${dep.deploy_date} ${dep.deploy_time} → now`}</div></div>
        <div class="soak-badge">${fmtSoak(em)}</div>
      </div>
    </div>
    <div class="field-block">
      <span class="sec-label">Deployment Details</span>${correctionButton("deployment",dep.ref_id)}${deleteRecordButton("deployment",dep.ref_id)}
      <div class="success-card">
        <div class="success-row"><span>Trap</span><span class="success-row-val">${dep.trap_id}</span></div>
        <div class="success-row"><span>Survey Site</span><span class="success-row-val">${dep.site||""}</span></div>
        <div class="success-row"><span>Deployed</span><span class="success-row-val">${dep.deploy_date} ${dep.deploy_time}</span></div>
        <div class="success-row"><span>GPS</span><span class="success-row-val">${dep.gps_lat}, ${dep.gps_lng}</span></div>
        ${dep.notes?`<div class="success-row"><span>Notes</span><span class="success-row-val">${dep.notes}</span></div>`:""}
      </div>
    </div>
    <div class="submit-wrap"><button class="primary-btn btn-checkin" onclick="startCheckin('${dep.ref_id}')">Log another check-in</button></div>
    <div class="field-block"><span class="sec-label">Catch history: all days</span>${trapChecks.length?trapChecks.map(checkinHistoryHtml).join(""):"<p>No check-ins yet.</p>"}</div>`;
}

window.startCheckin=async function(trapId){
  await refreshCheckinReceipt();
  if(_checkinReceipt){
    renderCheckinReceipt();
    showScreen("screen-checkin-form");
    if(!_checkinReceipt.uploaded) toast("Finish uploading the previous check-in before starting another.",5000);
    return;
  }
  const pendingCheckins=await DB.getPendingCheckins();
  if(pendingCheckins.length){
    toast("Upload the previous trap check-in before starting another.",5000);
    return;
  }
  const deps=await mergedDeployments();
  const dep=deps.find(d=>d.ref_id===trapId)||deps.find(d=>d.trap_id===trapId);
  if(!dep){ toast("Deployment record not found."); return; }
  state.checkinTrapId=dep.trap_id;
  state.checkinDeployRefId=dep.ref_id||"";
  const submitBtn=$("submit-checkin-btn"); if(submitBtn) submitBtn.disabled=false;
  $("ui-checkin-success").innerHTML="";
  currentSpecies=[]; addedSpeciesNames.clear(); swIdx=0;
  resetMudpuppyCheckinFields();
  const site=dep?(dep.site||dep.watershed||""):"";
  const depTime=dep?dep.deploy_time:"--";
  $("ui-checkin-hero").innerHTML=`
    <div class="hero checkin" style="margin-top:.2rem;">
      <div class="hero-eyebrow">Check-in</div>
      <div class="hero-title">Trap ${dep.trap_id}</div>
      <div class="hero-sub">${site} | deployed ${dep.deploy_date||""} ${depTime}</div>
    </div>`;
  state.checkinDeployDate=dep.deploy_date||"";
  state.checkinDeployTime=dep.deploy_time||"";
  ["air-temp-input","temp-input","water-ph-input"].forEach(id=>$(id).value="");
  setDateTimeInputs("checkin-date-input","checkin-time-input");
  updateCheckinSoakPreview();
  renderSpeciesCards();
  renderRecentSpecies();
  showScreen("screen-checkin-form");
};

function updateCheckinSoakPreview(){
  const date=$("checkin-date-input")?.value||"",time=$("checkin-time-input")?.value||"";
  const mins=soakMins(state.checkinDeployDate,state.checkinDeployTime,date,time);
  $("d-soak-badge").textContent=fmtSoak(mins);
  $("d-soak-val").textContent=`${state.checkinDeployDate||"--"} ${state.checkinDeployTime||"--:--"} → ${date||"--"} ${time||"--:--"}`;
}
window.updateCheckinSoakPreview=updateCheckinSoakPreview;

function openDeployForm(){
  setDateTimeInputs("deploy-date-input","deploy-time-input");
  $("ui-deploy-error").innerHTML="";
  $("ui-deploy-success").innerHTML="";
  showScreen("screen-deploy-form");
}
window.openDeployForm=openDeployForm;

// ============================================================
// SUBMIT: DEPLOY
// ============================================================
async function submitDeploy(forceDuplicate){
  if(_dataMaintenance){ toast("Please wait for record cleanup to finish."); return; }
  const trap=state.deployTrap,site=state.deploySite||"Unknown";
  const deployDate=$("deploy-date-input").value,deployTime=$("deploy-time-input").value;
  const lat=state.deployGpsLat,lng=state.deployGpsLng;
  const notes=$("deploy-notes").value.trim();
  const errs=[];
  if(!trap) errs.push("Please select a trap number.");
  if(!deployDate) errs.push("Please choose a deployment date.");
  if(!deployTime) errs.push("Please choose a deployment time.");
  if(deployDate&&deployTime&&!parseLocalDateTime(deployDate,deployTime)) errs.push("Choose a valid deployment date and time.");
  if(!lat||!lng) errs.push("GPS coordinates are required.");
  if(errs.length){ $("ui-deploy-error").innerHTML=`<div class="err-box"><div class="err-title">${errs.length} field${errs.length>1?"s":""} need attention:</div><ul class="err-list">${errs.map(e=>`<li>${e}</li>`).join("")}</ul></div>`; return; }
  if(!forceDuplicate){
    const deps=await mergedDeployments(),existing=deps.find(d=>d.trap_id===trap);
    if(existing){ toast(`Trap ${trap} is already deployed. Use Check-in to log another catch.`,5000); return; }
  }
  $("ui-deploy-error").innerHTML="";
  const rec={ref_id:newId("DEP"),submitted_at:nowISO(),trap_id:trap,site,deploy_date:deployDate,deploy_time:deployTime,gps_lat:lat,gps_lng:lng,notes};
  Object.assign(rec,projectMetadata());
  if(!await reviewRecord("Review deployment",rec))return;
  await DB.addPendingDeployment(rec);
  resetDeployForm(); buzz(40); trySyncAll(); renderHome();
  $("ui-deploy-success").innerHTML=`
    <div class="success-panel">
      <div class="success-icon deploy-icon">DEPLOYED</div>
      <div class="success-title deploy-color">Trap ${trap} deployed</div>
      <div class="success-sub">Deployment saved on device${navigator.onLine?" and syncing now.":": syncs when online."}</div>
      <div class="success-card">
        <div class="success-row"><span>Trap</span><span class="success-row-val">${trap}</span></div>
        <div class="success-row"><span>Survey Site</span><span class="success-row-val">${site}</span></div>
        <div class="success-row"><span>Deployed</span><span class="success-row-val">${deployDate} ${deployTime}</span></div>
        <div class="success-row"><span>GPS</span><span class="success-row-val">${lat}, ${lng}</span></div>
      </div>
      <button class="action-btn primary-deploy" onclick="openDeployForm()">Deploy next trap</button>
      <button class="action-btn secondary" onclick="$('ui-deploy-success').innerHTML='';showScreen('screen-home');switchMode('deploy');">Back to overview</button>
    </div>`;
}
window.submitDeploy=submitDeploy;

function resetDeployForm(){
  state.deployTrap=""; state.deployGpsLat=""; state.deployGpsLng="";
  $("val-deploy-trap").textContent="Select trap...";
  document.querySelectorAll("#dd-deploy-trap .select-option").forEach(o=>o.classList.remove("selected"));
  $("gps-btn-deploy").classList.remove("captured");
  $("gps-main-deploy").textContent="Tap to capture location";
  $("gps-tick-deploy").style.opacity="0";
  $("deploy-notes").value="";
  setDateTimeInputs("deploy-date-input","deploy-time-input");
}

// ============================================================
// SUBMIT: CHECK-IN
// ============================================================
function renderCheckinReceipt(){
  const r=_checkinReceipt,slot=$("ui-checkin-success");
  if(!r||!slot) return;
  const submitBtn=$("submit-checkin-btn"); if(submitBtn) submitBtn.disabled=true;
  const uploadMessage=r.uploaded
    ? `<div class="upload-confirmed" role="status">Record uploaded successfully. You can proceed to the next trap.</div>`
    : `<div class="upload-pending" role="status">Record saved on this device but not uploaded. ${escapeHtml(r.message||"Waiting for a connection.")} Complete this upload before the next check-in.</div>`;
  const nextAction=r.uploaded
    ? `<button class="action-btn primary-checkin" onclick="proceedAfterCheckinReceipt()">Check next trap</button><button class="action-btn secondary" onclick="showScreen('screen-home');switchMode('checkin');">Back to overview</button>`
    : `<button class="action-btn secondary" onclick="showScreen('screen-home');switchMode('checkin');">Back to overview</button>`;
  slot.innerHTML=`
    <div class="success-panel">
      <div class="success-icon">${r.uploaded?"UPLOADED":"SAVED"}</div>
      <div class="success-title checkin-color">Trap ${escapeHtml(r.trap)} checked in</div>
      ${uploadMessage}
      <div class="success-card">
        <div class="success-row"><span>Checked in</span><span class="success-row-val">${escapeHtml(r.checkinDate||"")} ${escapeHtml(r.checkinTime||"")}</span></div>
        <div class="success-row"><span>Soak time</span><span class="success-row-val">${fmtSoak(r.mins)}</span></div>
        <div class="success-row"><span>Bycatch</span><span class="success-row-val">${r.speciesCount?r.speciesCount+" species | "+r.totalFish+" fish":"None"}</span></div>
        ${r.flagN>0?`<div class="success-row"><span>Flagged</span><span class="success-row-val" style="color:var(--amber-lt);">${r.flagN} entr${r.flagN===1?"y":"ies"}</span></div>`:""}
        ${r.mpSnap&&r.mpCount>0?`<div class="success-row"><span>Mudpuppies</span><span class="success-row-val" style="color:var(--clay-lt);">${r.mpCount}: add metadata in Mudpuppies tab</span></div>`:""}
      </div>
      ${nextAction}
    </div>`;
  slot.scrollIntoView({behavior:"smooth",block:"nearest"});
}

function saveCheckinReceipt(){
  try{
    if(_checkinReceipt) localStorage.setItem(("fishtrap_checkin_receipt"+DATA_SUFFIX),JSON.stringify(_checkinReceipt));
    else localStorage.removeItem(("fishtrap_checkin_receipt"+DATA_SUFFIX));
  }catch(e){}
}

function proceedAfterCheckinReceipt(){
  if(!_checkinReceipt||!_checkinReceipt.uploaded){ toast("Wait for the record upload to finish before the next check-in.",5000); return; }
  _checkinReceipt=null; saveCheckinReceipt();
  $("ui-checkin-success").innerHTML="";
  showScreen("screen-home"); switchMode("checkin");
}
window.proceedAfterCheckinReceipt=proceedAfterCheckinReceipt;

async function refreshCheckinReceipt(){
  if(!_checkinReceipt||_checkinReceipt.uploaded) return;
  const pending=await DB.getPendingCheckins();
  const item=pending.find(c=>c.ref_id===_checkinReceipt.ref);
  if(!item){ _checkinReceipt.uploaded=true; _checkinReceipt.message=""; saveCheckinReceipt(); }
  else if(item._syncError){ _checkinReceipt.message=item._syncError; saveCheckinReceipt(); }
  renderCheckinReceipt();
}

async function submitCheckin(){
  if(_dataMaintenance){ toast("Please wait for record cleanup to finish."); return; }
  if(_checkinSubmitting) return;
  const trap=state.checkinTrapId;
  const errs=[];
  if(!trap) errs.push("No trap selected. Go back and tap a trap.");
  if(errs.length){ $("ui-checkin-error").innerHTML=`<div class="err-box"><div class="err-title">${errs.length} issue:</div><ul class="err-list">${errs.map(e=>`<li>${e}</li>`).join("")}</ul></div>`; return; }
  $("ui-checkin-error").innerHTML="";
  _checkinSubmitting=true;
  const submitBtn=$("submit-checkin-btn"); if(submitBtn) submitBtn.disabled=true;
  const ref=newId("CHK");
  try{
    const deps=await mergedDeployments(),dep=deps.find(d=>d.ref_id===state.checkinDeployRefId)||deps.find(d=>d.trap_id===trap);
    const depTime=dep?dep.deploy_time:"";
    const site=dep?(dep.site||dep.watershed||"Unknown"):"Unknown";
    const checkinDate=$("checkin-date-input").value,checkinTime=$("checkin-time-input").value;
    if(!checkinDate||!checkinTime) throw new Error("Choose a check-in date and time.");
    if(!parseLocalDateTime(checkinDate,checkinTime)) throw new Error("Choose a valid check-in date and time.");
    const mins=soakMins(dep?dep.deploy_date:"",depTime,checkinDate,checkinTime);
    if(mins===null) throw new Error("The deployment date or time is missing or invalid.");
    if(mins<0) throw new Error("Check-in time cannot be earlier than the deployment time.");
    const measurements=readSiteMeasurements();
    const totalFish=currentSpecies.reduce((a,c)=>a+(parseInt(c.count)||0),0);
    const flagN=currentSpecies.filter(c=>c.flagged).length;
    if(currentSpecies.some(c=>!Number.isInteger(Number(c.count))||Number(c.count)<1)) throw new Error("Every species count must be a positive whole number.");
    const speciesPayload=currentSpecies.map((c,i)=>({
      species:c.name,sci:c.sci,count:parseInt(c.count),
      length_cm:c.length_cm||"",weight_g:c.weight_g||"",flagged:c.flagged,
      sample_id:`${ref}_${slug(c.name)}_${i}`,
      photo_base64:c.photos.length>0?c.photos[0].base64:null,
      photo_count:c.photos.length
    }));
    const rec={
      ref_id:ref,deployment_ref_id:state.checkinDeployRefId,submitted_at:nowISO(),
      checkin_date:checkinDate,checkin_time:checkinTime,trap_id:trap,site,
      deploy_time:depTime,soak_mins:mins,gps_lat:state.checkinGpsLat,gps_lng:state.checkinGpsLng,
      weather:state.condWeather,...measurements,
      notes:$("checkin-notes").value.trim(),observer:$("observer-name").value.trim(),
      mudpuppy_caught:mudpuppyCaught,mudpuppy_count:mudpuppyCaught?mudpuppyCount:0,species:speciesPayload
    };

    rec.catch_status=totalFish===0&&!mudpuppyCaught?'no_animals_caught':'animals_caught';
    const previous=(await mergedCheckins()).filter(c=>checkinBelongsTo(c,dep)&&`${c.checkin_date} ${c.checkin_time}`<`${checkinDate} ${checkinTime}`).sort((a,b)=>`${b.checkin_date} ${b.checkin_time}`.localeCompare(`${a.checkin_date} ${a.checkin_time}`))[0];
    rec.previous_checkin_ref_id=previous?.ref_id||'';
    rec.interval_mins=previous?soakMins(previous.checkin_date,previous.checkin_time,checkinDate,checkinTime):mins;
    rec.interval_basis=previous?'previous_check':'deployment';
    Object.assign(rec,projectMetadata());
    if(!rec.observer) throw new Error('Enter the observer name.');
    if(!await reviewRecord('4. Review check-in',rec)) return;
    await DB.addPendingCheckin(rec);
    addToRecentSpecies(currentSpecies);
    const mpSnap=mudpuppyCaught,mpCount=mudpuppyCount;
    if(mudpuppyCaught&&mudpuppyCount>0){
      for(let i=0;i<mudpuppyCount;i++) await DB.addPendingMudpuppy({
        id:newId("MP"),trap_id:trap,checkin_ref_id:ref,site,
        catch_date:checkinDate,individual_index:i+1,total_in_catch:mudpuppyCount,
        photo_base64:null,sex:"",weight_g:"",svl_mm:"",swab_vial_id:"",pit_tag_id:"",tissue_vial_id:"",
        notes:"",submitted_at:nowISO(),updated_at:nowISO()
      });
    }
    _checkinReceipt={ref,trap,checkinDate,checkinTime,mins,totalFish,speciesCount:speciesPayload.length,flagN,mpSnap,mpCount,uploaded:false,message:navigator.onLine?"Uploading record…":"Waiting for a connection."};
    saveCheckinReceipt();
    resetCheckinForm(); buzz(40); renderCheckinReceipt(); await renderHome();
    const syncResult=await trySyncAll();
    const outcome=syncResult.outcomes&&syncResult.outcomes["checkin:"+ref];
    if(outcome&&outcome.ok){ _checkinReceipt.uploaded=true; _checkinReceipt.message=""; saveCheckinReceipt(); }
    else{
      const pending=await DB.getPendingCheckins(),local=pending.find(c=>c.ref_id===ref);
      _checkinReceipt.message=(outcome&&outcome.message)||(local&&local._syncError)||(navigator.onLine?"Upload is pending.":"Waiting for a connection.");
      saveCheckinReceipt();
    }
    renderCheckinReceipt(); await renderHome();
  }catch(e){
    console.error("Check-in save/upload failed:",e);
    if(_checkinReceipt&&_checkinReceipt.ref===ref){ _checkinReceipt.message=e.message||"Upload is pending."; renderCheckinReceipt(); }
    else $("ui-checkin-error").innerHTML=`<div class="err-box">Could not save this check-in: ${escapeHtml(e.message||"Unknown error.")}</div>`;
  }finally{
    _checkinSubmitting=false; if(submitBtn) submitBtn.disabled=!!(_checkinReceipt&&_checkinReceipt.ref===ref);
  }
}
window.submitCheckin=submitCheckin;

function resetCheckinForm(){
  currentSpecies=[]; addedSpeciesNames.clear(); swIdx=0;
  renderSpeciesCards(); renderRecentSpecies();
  $("checkin-notes").value=""; $("observer-name").value="";
  resetMudpuppyCheckinFields();
}

// ============================================================
// CLEAR / ARCHIVE
// ============================================================
function showClearConfirm(){
  $("ui-clear-confirm").innerHTML=`
    <div class="confirm-box">
      <p>Archives all current deployments, check-ins, and catches to history tabs, then clears this survey. Requires internet and all pending records to be uploaded first.</p>
      <div class="confirm-btns">
        <button class="confirm-yes" onclick="confirmClear()">Yes, clear and start fresh</button>
        <button class="confirm-no" onclick="$('ui-clear-confirm').innerHTML=''">Cancel</button>
      </div>
    </div>`;
}
window.showClearConfirm=showClearConfirm;
async function confirmClear(){
  $("ui-clear-confirm").innerHTML="";
  if(!navigator.onLine){ toast("You're offline: connect to clear/archive."); return; }
  try{
    await trySyncAll();
    const pendingLists=await Promise.all([DB.getPendingDeployments(),DB.getPendingCheckins(),DB.getPendingMudpuppies()]);
    if(pendingLists.some(list=>list.length)){ toast("Some records are still waiting to upload. Clear the survey after they sync.",5000); return; }
    const resp=await callServer("clear",{});
    if(resp&&resp.ok){ _checkinReceipt=null; saveCheckinReceipt(); toast("Traps cleared and archived. Ready for a new survey."); await refreshFromServer(); renderHome(); }
    else toast("Error: "+(resp&&resp.message?resp.message:"unknown"));
  }catch(e){ toast("Error: "+e.message); }
}
window.confirmClear=confirmClear;

// ============================================================
// Record cleanup: only enabled by an explicit, confirmed user action.
let _dataMaintenance=false;
function deleteRecordButton(kind,id){
  if(!id) return "";
  return `<button type="button" class="delete-record-btn" data-delete-kind="${kind}" data-delete-id="${escapeHtml(String(id))}">Delete this ${kind==='deployment'?'deployment':kind==='checkin'?'check-in':'specimen record'}</button>`;
}
document.addEventListener("click",event=>{
  const button=event.target.closest("[data-delete-kind]");
  if(button){ event.stopPropagation(); deleteSurveyRecord(button.dataset.deleteKind,button.dataset.deleteId); }
});
async function deleteSurveyRecord(kind,id){
  if(_dataMaintenance) return;
  const scope=kind==='deployment'?"this deployment and all of its linked check-ins, catches and specimen records":kind==='checkin'?"this check-in and its linked catches and specimen records":"this individual specimen record (the check-in catch count stays unchanged)";
  if(!window.confirm(`Permanently delete ${scope}? This also removes matching pending records on this device. Other records are kept. Drive photos are kept. This cannot be undone.`)) return;
  await performRecordCleanup(kind,id);
}
window.deleteAllSurveyData=async function(){
  if(_dataMaintenance) return;
  if(window.prompt("Dataset: "+DATA_MODE.toUpperCase()+". Permanently delete ALL survey records, including deployments, check-ins, catches, mudpuppies, archived history and pending records on this device? This includes real data, not only tests. Drive photos are kept. Type DELETE ALL to continue.")!=="DELETE ALL") return;
  await performRecordCleanup("all","");
};
async function performRecordCleanup(kind,id){
  if(_checkinSubmitting){ toast("Wait for the check-in save to finish before deleting records.",5000); return; }
  if(!navigator.onLine){ toast("Connect to the internet to delete records from both the app and spreadsheet.",5000); return; }
  _dataMaintenance=true;
  try {
    if(_syncInFlight) await _syncInFlight;
    const deps=await mergedDeployments(),checks=await mergedCheckins();
    const dep=deps.find(d=>d.ref_id===id);
    const removedChecks=new Set(kind==='all'?checks.map(c=>c.ref_id):kind==='checkin'?[id]:kind==='deployment'&&dep?checks.filter(c=>checkinBelongsTo(c,dep)).map(c=>c.ref_id):[]);
    const resp=await callServer(kind==='all'?"deleteAll":"deleteRecord",kind==='all'?{confirmation:"DELETE ALL"}:{kind,id});
    if(!resp||!resp.ok) throw new Error(resp?.message||"Deletion was not confirmed. Update and deploy the latest Code.gs.");
    (resp.deleted_checkins||[]).forEach(ref=>removedChecks.add(ref));
    for(const r of await DB.getPendingDeployments()) if(kind==='all'||kind==='deployment'&&r.ref_id===id) await DB.removePendingDeployment(r.ref_id);
    for(const r of await DB.getPendingCheckins()) if(kind==='all'||removedChecks.has(r.ref_id)) await DB.removePendingCheckin(r.ref_id);
    const keepMp=r=>!(kind==='all'||kind==='mudpuppy'&&r.id===id||removedChecks.has(r.checkin_ref_id));
    for(const r of await DB.getPendingMudpuppies()) if(!keepMp(r)) await DB.removePendingMudpuppy(r.id);
    serverToday={deployments:(serverToday.deployments||[]).filter(r=>!(kind==='all'||kind==='deployment'&&r.ref_id===id)),checkins:(serverToday.checkins||[]).filter(r=>kind!=='all'&&!removedChecks.has(r.ref_id))};
    await DB.cacheServer(serverToday);
    await DB.cacheMudpuppies((await DB.getMudpuppyCache()||[]).filter(keepMp));
    if(kind==='all'||_checkinReceipt&&removedChecks.has(_checkinReceipt.ref)){ _checkinReceipt=null; saveCheckinReceipt(); }
    if(kind==='all'){ currentSpecies=[]; addedSpeciesNames.clear(); }
    await renderHome(); await renderMudpuppyList(); await updateStatusBar(); await renderSyncIssues();
    showScreen("screen-home");
    toast(kind==='all'?"All survey records deleted. Ready for a clean test.":"Record deleted.",5000);
  } catch(e){ toast("Cleanup error: "+e.message,7000); }
  finally { _dataMaintenance=false; }
}

// SERVER COMMUNICATION
// ============================================================
function getAppsScriptUrl(){
  if(!CFG||!CFG.APPS_SCRIPT_URL||CFG.APPS_SCRIPT_URL.includes("PASTE_YOUR"))
    throw new Error("Apps Script URL is not configured in config.js.");
  return CFG.APPS_SCRIPT_URL;
}
async function fetchServerJson(url,options){
  const resp=await fetch(url,options);
  if(!resp.ok) throw new Error(`Apps Script returned HTTP ${resp.status}.`);
  try{ return await resp.json(); }
  catch(e){ throw new Error("Apps Script returned an unreadable response. Check the web app deployment and permissions."); }
}
async function callServer(action,payload){
  const capability=await fetchServerJson(getAppsScriptUrl()+"?action=capabilities&mode="+DATA_MODE);
  if(!capability?.ok||capability.version!==8) throw new Error("Update and redeploy Code.gs before saving or deleting records.");
  return fetchServerJson(getAppsScriptUrl(),{
    method:"POST",
    headers:{"Content-Type":"text/plain;charset=utf-8"},
    body:JSON.stringify({action,payload,mode:DATA_MODE,client_version:8})
  });
}
async function refreshFromServer(){
  try{
    const data=await fetchServerJson(getAppsScriptUrl()+"?action=survey&mode="+DATA_MODE);
    if(data&&data.ok&&data.history_version===3){ serverToday={deployments:data.deployments||[],checkins:data.checkins||[]}; await DB.cacheServer(serverToday); return {ok:true}; }
    return {ok:false,message:"Update and redeploy Code.gs to enable all-days survey history."};
  }catch(e){ return {ok:false,message:e.message||"Could not load the survey history."}; }
}
async function refreshMudpuppiesFromServer(){
  try{
    const data=await fetchServerJson(getAppsScriptUrl()+"?action=mudpuppies&mode="+DATA_MODE);
    if(data&&data.ok){ await DB.cacheMudpuppies(data.mudpuppies||[]); return {ok:true}; }
    return {ok:false,message:(data&&data.message)||"Apps Script did not return mudpuppy records."};
  }catch(e){ return {ok:false,message:e.message||"Could not load mudpuppy records."}; }
}

function updateSyncModeLabel(){
  const el=$("sync-mode-indicator"); if(!el) return;
  const syncing=!!_syncInFlight, online=navigator.onLine;
  el.textContent=!online?"Auto-sync paused":(syncing?"Syncing…":(_lastSyncError?"Sync issue":"Auto-sync on"));
  el.title=_lastSyncError||"Uploads once after saving. Reconnect, reopen the app, or save another record to retry a failed upload.";
  el.classList.toggle("is-syncing",online&&syncing);
  el.classList.toggle("is-paused",!online);
  el.classList.toggle("has-error",online&&!syncing&&!!_lastSyncError);
}

async function trySyncAll(){
  if(_dataMaintenance) return {ok:false,message:"Record cleanup in progress.",outcomes:{}};
  if(_syncInFlight){ _syncAgain=true; return _syncInFlight; }
  const capability=await fetchServerJson(getAppsScriptUrl()+"?action=capabilities&mode="+DATA_MODE).catch(()=>null);
  if(!capability?.ok||capability.version!==8){toast("Update and redeploy Code.gs before uploading this version.",6000);return {ok:false,outcomes:{},message:"Backend update required."};}
  const attempted=new Set(),outcomes={};
  _syncInFlight=(async()=>{
    let result={ok:false,message:"No sync pass completed.",outcomes:{}};
    do{
      _syncAgain=false;
      result=await runSyncCycle(attempted);
      Object.assign(outcomes,result.outcomes||{});
    }while(_syncAgain&&navigator.onLine&&!result.networkDown);
    return {...result,outcomes};
  })();
  updateSyncModeLabel();
  try{ return await _syncInFlight; }
  finally{
    _syncInFlight=null; updateSyncModeLabel();
    try{ await refreshCheckinReceipt(); }catch(e){}
    try{ await renderSyncIssues(); }catch(e){}
  }
}

async function runSyncCycle(attempted){
  const outcomes={};
  if(!navigator.onLine){ _lastSyncError=""; await updateStatusBar(); return {ok:false,message:"You are offline. Saved records will sync when you reconnect.",outcomes,networkDown:false}; }
  let networkDown=false, syncError="", rejected=0, refreshError="";
  async function syncStore(getAll,addBack,remove,action,idKey){
    if(networkDown) return;
    const items=await getAll();
    for(const item of items){
      if(networkDown) break;
      const outcomeKey=action+":"+item[idKey];
      if(attempted.has(outcomeKey)) continue;
      attempted.add(outcomeKey);
      try{
        const resp=await callServer(action,item);
        if(resp&&resp.ok){
          // Preserve confirmed uploads locally even if the following history fetch fails.
          if(action==="deploy"||action==="checkin"){
            const field=action==="deploy"?"deployments":"checkins";
            serverToday[field]=[...(serverToday[field]||[]).filter(r=>r.ref_id!==item.ref_id),item];
            await DB.cacheServer(serverToday);
          }
          await remove(item[idKey]); outcomes[outcomeKey]={ok:true};
        }
        else{
          const message=(resp&&resp.message)||"Server rejected record.";
          rejected++; if(!syncError) syncError=message;
          await addBack({...item,_syncError:message,_lastAttempt:nowISO()});
          outcomes[outcomeKey]={ok:false,message};
        }
      }catch(e){
        networkDown=true;
        const message=e.message||"Could not reach Apps Script.";
        if(!syncError) syncError=message;
        await addBack({...item,_syncError:message,_lastAttempt:nowISO()});
        outcomes[outcomeKey]={ok:false,message};
      }
    }
  }
  await syncStore(DB.getPendingDeployments,DB.addPendingDeployment,DB.removePendingDeployment,"deploy","ref_id");
  await syncStore(DB.getPendingCheckins,   DB.addPendingCheckin,   DB.removePendingCheckin,   "checkin","ref_id");
  await syncStore(DB.getPendingMudpuppies, DB.addPendingMudpuppy,  DB.removePendingMudpuppy,  "mudpuppySave","id");
  if(!networkDown){
    const todayResult=await refreshFromServer();
    const mudpuppyResult=await refreshMudpuppiesFromServer();
    if(!todayResult.ok) refreshError=todayResult.message;
    else if(!mudpuppyResult.ok) refreshError=mudpuppyResult.message;
  }
  await updateStatusBar(); await renderHome();
  if(document.getElementById("view-mudpuppies").style.display!=="none") renderMudpuppyList();
  const pendingLists=await Promise.all([DB.getPendingDeployments(),DB.getPendingCheckins(),DB.getPendingMudpuppies()]);
  const pendingCount=pendingLists.reduce((sum,list)=>sum+list.length,0);
  const ok=!networkDown&&rejected===0&&!refreshError&&pendingCount===0;
  let message="";
  if(networkDown) message=syncError||"Could not reach Apps Script.";
  else if(rejected) message=syncError||`${rejected} record(s) were rejected by Apps Script.`;
  else if(refreshError) message=refreshError;
  else if(pendingCount){
    const firstIssue=pendingLists.flat().find(item=>item._syncError);
    message=(firstIssue&&firstIssue._syncError)||`${pendingCount} record(s) are still pending.`;
  }
  _lastSyncError=ok?"":message;
  if(ok){ try{ localStorage.setItem("fishtrap_last_sync",Date.now().toString()); }catch(e){} }
  return {ok,message,pending:pendingCount,outcomes,networkDown};
}

function timeAgo(ms){
  const diff=Math.max(0,Date.now()-ms),mins=Math.floor(diff/60000);
  if(mins<1) return "just now"; if(mins<60) return mins+"m ago";
  const hrs=Math.floor(mins/60); if(hrs<24) return hrs+"h ago";
  return Math.floor(hrs/24)+"d ago";
}

async function renderSyncIssues(){
  const deps=await DB.getPendingDeployments(),checks=await DB.getPendingCheckins(),mps=await DB.getPendingMudpuppies();
  const issues=[
    ...deps.filter(d=>d._syncError).map(d=>({type:"Deployment",label:`Trap ${d.trap_id}`,msg:d._syncError,action:"deploy",item:d})),
    ...checks.filter(c=>c._syncError).map(c=>({type:"Check-in",label:`Trap ${c.trap_id}`,msg:c._syncError,action:"checkin",item:c})),
    ...mps.filter(m=>m._syncError).map(m=>({type:"Mudpuppy",label:`Trap ${m.trap_id} #${m.individual_index}`,msg:m._syncError,action:"mudpuppySave",item:m}))
  ];
  const slot=$("sync-issues-slot");
  if(!issues.length){
    slot.innerHTML=_lastSyncError?`<div class="sync-issues-banner"><div class="sync-issues-head"><span>Server sync issue</span></div><div class="sync-issue-item"><div class="msg">${escapeHtml(_lastSyncError)}</div><div class="sync-issue-auto">Retry after reconnecting, reopening the app, or saving another record.</div></div></div>`:"";
    return;
  }
  slot.innerHTML=`<div class="sync-issues-banner">
    <div class="sync-issues-head"><span>${issues.length} record${issues.length>1?"s":""} need attention</span></div>
    ${issues.map(iss=>`<div class="sync-issue-item">${escapeHtml(iss.type)}: ${escapeHtml(iss.label)}<div class="msg">${escapeHtml(iss.msg)}</div>
      <div class="sync-issue-auto">Retry after reconnecting, reopening the app, or saving another record.</div></div>`).join("")}
  </div>`;
}

async function updateStatusBar(){
  const online=navigator.onLine;
  $("status-dot").className="status-dot "+(online?"online":"offline");
  $("status-text").textContent=online?"Online":"Offline: entries saved on this device";
  const deps=await DB.getPendingDeployments(),checks=await DB.getPendingCheckins(),mps=await DB.getPendingMudpuppies();
  const n=deps.length+checks.length+mps.length;
  $("status-pending").textContent=n?`${n} pending sync`:"";
  $("status-bar").className="status-bar "+(online?"is-online":"is-offline")+(n&&online?" has-pending":"");
  updateSyncModeLabel();
  let lastSync=null; try{ lastSync=localStorage.getItem("fishtrap_last_sync"); }catch(e){}
  $("last-synced-row").innerHTML=lastSync?`Last synced ${timeAgo(parseInt(lastSync))}`:(online?"":"Not yet synced this session");
  await renderSyncIssues();
}

// ── service worker ─────────────────────────────────────────
if("serviceWorker" in navigator){
  window.addEventListener("load",()=>{ navigator.serviceWorker.register("sw.js").catch(()=>{}); });
}
window.addEventListener("online",()=>trySyncAll());
window.addEventListener("offline",()=>{ updateStatusBar(); updateSyncModeLabel(); });

// ── ALL EVENT LISTENERS: inside DOMContentLoaded ──────────
document.addEventListener("DOMContentLoaded", ()=>{

  // Species photo input (one photo per tap, attached to current card)
  const spPhotoInput=$("species-photo-input");
  if(spPhotoInput){
    spPhotoInput.addEventListener("change", async (e)=>{
      const file=e.target.files[0]; e.target.value="";
      if(!file||!_photoTargetId) return;
      const dataUrl=await fileToDataUrl(file);
      const card=currentSpecies.find(c=>c.id===_photoTargetId);
      if(card){ card.photos.push({dataUrl,base64:dataUrl.split(",")[1]}); }
      _photoTargetId=null;
      renderSpeciesCards();
      toast("Photo saved: uploads to Drive on sync.");
    });
  }

  // Mudpuppy detail photo
  const mpPhotoInput=$("mp-detail-photo-input");
  if(mpPhotoInput){
    mpPhotoInput.addEventListener("change", async (e)=>{
      const file=e.target.files[0]; e.target.value="";
      if(!file) return;
      const dataUrl=await fileToDataUrl(file);
      _mpDetailNewPhoto={dataUrl,base64:dataUrl.split(",")[1]};
      const box=$("mp-detail-photo");
      if(box){ box.style.backgroundImage=`url('${dataUrl}')`; box.textContent=""; }
    });
  }

  ["checkin-date-input","checkin-time-input"].forEach(id=>{
    const input=$(id);
    if(input) input.addEventListener("input",updateCheckinSoakPreview);
  });

  // init
  (async ()=>{
    // Restore theme preference
    try{
      const saved=localStorage.getItem("fishtrap_theme");
      if(saved==="day"||saved==="night"){
        document.documentElement.setAttribute("data-theme",saved);
        $("theme-icon").textContent=saved==="day"?"☽":"☀";
        $("theme-label").textContent=saved==="day"?"Night mode":"Day mode";
      }
    }catch(e){}

    setDateTimeInputs("deploy-date-input","deploy-time-input");
    buildTrapDropdown();
    buildSiteChips();
    buildSheetTabs();

    const cached=await DB.getServerCache();
    if(cached) serverToday=cached;
    try{
      const savedReceipt=localStorage.getItem(("fishtrap_checkin_receipt"+DATA_SUFFIX));
      if(savedReceipt) _checkinReceipt=JSON.parse(savedReceipt);
    }catch(e){ _checkinReceipt=null; }

    await updateStatusBar();
    await renderHome();

    updateSyncModeLabel();
    if(navigator.onLine) await trySyncAll();
  })();
});
