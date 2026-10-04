// Dataset mode is fixed for this page and accompanies every server request.
const DATA_MODE=new URLSearchParams(location.search).get('mode')==='practice'?'practice':'research';
const DATA_SUFFIX=DATA_MODE==='practice'?'_practice':'';
function projectDetails(){try{return JSON.parse(localStorage.getItem('fishtrap_project')||'{}')}catch{return {}}}
function projectMetadata(){const p=projectDetails();return {project_title:p.title||'NM Field Survey',institution:p.institution||'',research_team:p.team||'',protocol_version:p.protocol||'',dataset_mode:DATA_MODE};}
function reviewRecord(title,rec){
  return new Promise(resolve=>{
    const dialog=document.createElement('dialog');dialog.className='research-dialog';
    const rows=[['Dataset',DATA_MODE==='practice'?'PRACTICE: test data':'RESEARCH'],['Trap',rec.trap_id],['Site',rec.site],['Date',rec.checkin_date||rec.deploy_date],['Time',rec.checkin_time||rec.deploy_time]];
    if(rec.species){rows.push(['Observer',rec.observer],['Air temperature',rec.air_temp_c===''?'Not measured':rec.air_temp_c+' °C'],['Water temperature',rec.water_temp_c===''?'Not measured':rec.water_temp_c+' °C'],['Water pH',rec.water_ph===''?'Not measured':rec.water_ph],['Catch',rec.catch_status],['Mudpuppies',rec.mudpuppy_count]);rec.species.forEach(sp=>rows.push([sp.species,sp.count+' caught']));}
    rows.push(['Notes',rec.notes||'None']);
    dialog.innerHTML=`<h2>${escapeHtml(title)}</h2><p>Check these details before saving.</p>${rows.map(([k,v])=>`<div class="success-row"><strong>${escapeHtml(k)}</strong><span>${escapeHtml(String(v??''))}</span></div>`).join('')}<button class="primary-btn btn-checkin" id="review-confirm">Confirm & save</button><button class="action-btn secondary" id="review-back">Back to editing</button>`;
    document.body.append(dialog);const finish=v=>{dialog.close();dialog.remove();resolve(v)};
    dialog.querySelector('#review-confirm').onclick=()=>finish(true);dialog.querySelector('#review-back').onclick=()=>finish(false);dialog.addEventListener('cancel',e=>{e.preventDefault();finish(false)});dialog.showModal();
  });
}
async function switchDataset(){
  if(_syncInFlight||_checkinSubmitting||_dataMaintenance){toast('Wait for the current operation to finish.');return;}
  if(!confirm('Switch datasets? Unsubmitted form edits will be discarded. Saved pending records stay in their original dataset.'))return;
  const u=new URL(location.href);u.searchParams.set('mode',DATA_MODE==='practice'?'research':'practice');location.href=u.href;
}
function correctionButton(kind,id){return id?`<button class="action-btn secondary" data-correct-kind="${kind}" data-correct-id="${escapeHtml(String(id))}">Correct this record</button>`:'';}
async function openCorrection(kind,id){
  if(_syncInFlight||_dataMaintenance){toast('Wait for syncing to finish.');return;}
  const list=kind==='deployment'?await mergedDeployments():kind==='checkin'?await mergedCheckins():await mergedMudpuppies();const r=list.find(x=>(x.ref_id||x.id)===id);
  if(!r||r._pending){toast('Upload this record before correcting it.');return;}
  const fields=kind==='deployment'?[['site','Site'],['notes','Notes']]:kind==='checkin'?[['observer','Observer'],['air_temp_c','Air temperature (°C)'],['water_temp_c','Water temperature (°C)'],['water_ph','Water pH'],['weather','Weather'],['notes','Notes']]:[['sex','Sex'],['weight_g','Weight (g)'],['svl_mm','Snout–vent length (mm)'],['swab_vial_id','Swab vial ID'],['pit_tag_id','PIT tag ID'],['tissue_vial_id','Tissue vial ID'],['notes','Notes']];
  const d=document.createElement('dialog');d.className='research-dialog';
  d.innerHTML=`<h2>Correct record</h2><p>The original values are retained in the correction log. Dates, trap links and catch counts cannot be changed here.</p><form>${fields.map(([key,label])=>`<label>${label}<input class="text-input" name="${key}" value="${escapeHtml(String(r[key]??''))}"></label>`).join('')}<label>Corrected by<input class="text-input" name="author" required></label><label>Reason for correction<textarea class="notes-ta" name="reason" required></textarea></label><p class="correction-error" role="alert"></p><button class="primary-btn btn-checkin" type="submit">Save correction</button><button class="action-btn secondary" type="button" id="cancel-correction">Cancel</button></form>`;
  document.body.append(d);d.showModal();d.querySelector('#cancel-correction').onclick=()=>{d.close();d.remove()};d.addEventListener('cancel',()=>d.remove());
  d.querySelector('form').onsubmit=async event=>{
    event.preventDefault();const form=new FormData(event.target),patch={},before={};fields.forEach(([key])=>{patch[key]=form.get(key);before[key]=r[key]??''});
    const button=d.querySelector('[type=submit]');button.disabled=true;_dataMaintenance=true;
    try{if(_syncInFlight)await _syncInFlight;const result=await callServer('correct',{kind,id,patch,before,author:form.get('author'),reason:form.get('reason'),correction_id:newId('COR')});if(!result.ok)throw Error(result.message||'Correction failed');await refreshFromServer();await refreshMudpuppiesFromServer();await renderHome();showScreen('screen-home');d.close();d.remove();toast('Correction saved with original values and reason.');}catch(e){d.querySelector('.correction-error').textContent=e.message;}finally{_dataMaintenance=false;button.disabled=false;}
  };
}
document.addEventListener('click',e=>{const b=e.target.closest('[data-correct-kind]');if(b){e.stopPropagation();openCorrection(b.dataset.correctKind,b.dataset.correctId)}});
document.addEventListener('DOMContentLoaded',()=>{
  const banner=document.getElementById('dataset-banner');banner.innerHTML=`<strong>${DATA_MODE==='practice'?'PRACTICE · test data only':'RESEARCH · field records'}</strong>`;
  document.getElementById('dataset-switch').textContent=DATA_MODE==='practice'?'Switch to research':'Switch to practice';
  banner.classList.toggle('practice',DATA_MODE==='practice');
  const p=projectDetails();for(const k of ['title','institution','team','protocol'])document.getElementById('project-'+k).value=p[k]||'';
  document.getElementById('project-save').onclick=()=>{const p={};for(const k of ['title','institution','team','protocol'])p[k]=document.getElementById('project-'+k).value.trim();localStorage.setItem('fishtrap_project',JSON.stringify(p));toast('Project details saved on this device.');};
});
