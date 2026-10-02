/**

 * Fish Trap Survey — Apps Script backend

 * Deploy as: Web App, Execute as "Me", Access "Anyone"

 *

 * Required Script Properties:

 *   SHEET_ID        - Google Sheet ID (tabs are created as needed: deployments, checkins, catches, mudpuppies)

 *

 * Bycatch photos go to the dedicated Drive folder:

 *   11MutIp3rVTGF8vrqAvL4f0_Rez_0AmuB

 * (hardcoded — no Script Property needed for photos)

 *

 * No iNaturalist AI. Species selected manually in the app.

 */



// Drive folder for all bycatch photos

const BYCATCH_FOLDER_ID = "11MutIp3rVTGF8vrqAvL4f0_Rez_0AmuB";



function getProp(key) {

  return PropertiesService.getScriptProperties().getProperty(key);

}



function getSheet(name) {

  const ss = SpreadsheetApp.openById(getProp("SHEET_ID"));

  let sh = ss.getSheetByName(name);

  if (!sh) sh = ss.insertSheet(name);

  return sh;

}



function jsonOut(obj) {

  return ContentService

    .createTextOutput(JSON.stringify(obj))

    .setMimeType(ContentService.MimeType.JSON);

}



function todayStr() {

  return Utilities.formatDate(

    new Date(),

    Session.getScriptTimeZone() || "America/Chicago",

    "yyyy-MM-dd"

  );

}



function ensureHeaders(sh, headers) {

  const firstRow = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0];

  if (!firstRow.some(function (v) { return v !== ""; })) {

    sh.getRange(1, 1, 1, headers.length).setValues([headers]);

  }

}



function appendRowByHeader(sh, obj) {

  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];

  const row = headers.map(function (h) {

    const v = obj[h];

    return (v === undefined || v === null) ? "" : v;

  });

  sh.appendRow(row);

}



// ============================================================

// doGet

// ============================================================

function rowValuesByHeader(headers, obj) {
  return headers.map(function (h) {
    const v = obj[h];
    return (v === undefined || v === null) ? "" : v;
  });
}

function upsertRowByHeader(sh, obj, keyHeader, keyValue) {
  const values = sh.getDataRange().getValues();
  const headers = values[0], keyCol = headers.indexOf(keyHeader);
  if (keyCol < 0) throw new Error("Missing " + keyHeader + " column.");
  const matches = [];
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][keyCol]) === String(keyValue)) matches.push(i + 1);
  }
  const row = rowValuesByHeader(headers, obj);
  if (!matches.length) {
    sh.appendRow(row);
    return;
  }
  sh.getRange(matches[0], 1, 1, headers.length).setValues([row]);
  for (let i = matches.length - 1; i >= 1; i--) sh.deleteRow(matches[i]);
}

function deleteRowsByValue(sh, keyHeader, keyValue) {
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return;
  const keyCol = values[0].indexOf(keyHeader);
  if (keyCol < 0) throw new Error("Missing " + keyHeader + " column.");
  for (let i = values.length - 1; i >= 1; i--) {
    if (String(values[i][keyCol]) === String(keyValue)) sh.deleteRow(i + 1);
  }
}

function doGet(e) {
  const action = (e.parameter && e.parameter.action) || "";
  if (action === "today") {
    return jsonOut({
      ok: true,
      deployments: readAllRows("deployments"),
      checkins: readAllCheckins()
    });
  }
  if (action === "mudpuppies") {
    return jsonOut({ ok: true, mudpuppies: readAllRows("mudpuppies") });
  }
  return jsonOut({ ok: false, message: "Unknown action." });
}

function normalizeSheetValue(header, value) {
  if (!(value instanceof Date)) return value;
  const tz = Session.getScriptTimeZone() || "America/Chicago";
  if (/_date$/.test(header) || header === "catch_date") return Utilities.formatDate(value, tz, "yyyy-MM-dd");
  if (/_time$/.test(header)) return Utilities.formatDate(value, tz, "HH:mm");
  return value.toISOString();
}

function readAllRows(sheetName) {
  const sh = getSheet(sheetName), values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0], rows = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (row.every(function (v) { return v === ""; })) continue;
    const obj = {};
    headers.forEach(function (h, idx) { obj[h] = normalizeSheetValue(h, row[idx]); });
    rows.push(obj);
  }
  return rows;
}

function readAllCheckins() {
  const byRef = {};
  readAllRows("catches").forEach(function (row) {
    const key = row.ref_id || [row.trap_id, row.checkin_date, row.checkin_time].join(":");
    if (!byRef[key]) byRef[key] = Object.assign({}, row, { deployment_ref_id: "" });
  });
  readAllRows("checkins").forEach(function (row) {
    const key = row.ref_id || [row.trap_id, row.checkin_date, row.checkin_time].join(":");
    byRef[key] = row;
  });
  return Object.keys(byRef).map(function (key) { return byRef[key]; });
}


function doPost(e) {

  let body;

  try { body = JSON.parse(e.postData.contents); }

  catch (err) { return jsonOut({ ok: false, message: "Bad JSON body." }); }



  const action = body.action || "", payload = body.payload || {};

  try {

    if (action === "deploy")       return handleDeploy(payload);

    if (action === "checkin")      return handleCheckin(payload);

    if (action === "mudpuppySave") return handleMudpuppySave(payload);

    if (action === "clear")        return handleClear();

    return jsonOut({ ok: false, message: "Unknown action: " + action });

  } catch (err) {

    return jsonOut({ ok: false, message: String(err) });

  }

}



// ============================================================

// DEPLOY

// ============================================================

function handleDeploy(rec) {
  if (!rec || !rec.ref_id) return jsonOut({ ok: false, message: "Deployment ref_id is required." });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = getSheet("deployments");
    ensureHeaders(sh, ["ref_id","submitted_at","trap_id","site","deploy_date","deploy_time","gps_lat","gps_lng","notes"]);
    upsertRowByHeader(sh, rec, "ref_id", rec.ref_id);
    return jsonOut({ ok: true, ref_id: rec.ref_id });
  } finally {
    lock.releaseLock();
  }
}


function handleCheckin(rec) {
  if (!rec || !rec.ref_id) return jsonOut({ ok: false, message: "Check-in ref_id is required." });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const checkins = getSheet("checkins");
    ensureHeaders(checkins, [
      "ref_id","deployment_ref_id","submitted_at","checkin_date","checkin_time",
      "trap_id","site","deploy_time","soak_mins","gps_lat","gps_lng",
      "clarity","weather","water_temp_c","notes","observer",
      "mudpuppy_caught","mudpuppy_count","species_count","fish_count"
    ]);
    const catches = getSheet("catches");
    ensureHeaders(catches, [
      "ref_id","submitted_at","checkin_date","checkin_time",
      "trap_id","site","deploy_time","soak_mins",
      "gps_lat","gps_lng","species","sci_name",
      "count","length_cm","weight_g","flagged","photo_url",
      "clarity","weather","water_temp_c","notes","observer","sample_id"
    ]);

    const species = Array.isArray(rec.species) ? rec.species : [];
    const fishCount = species.reduce(function (sum, sp) { return sum + (Number(sp.count) || 0); }, 0);
    const summary = Object.assign({}, rec, {
      species_count: species.length,
      fish_count: fishCount,
      mudpuppy_caught: !!rec.mudpuppy_caught,
      mudpuppy_count: Number(rec.mudpuppy_count) || 0
    });
    delete summary.species;
    delete summary.photo_base64;

    // Replace rows with this ref_id so a retry cannot create duplicate catch rows.
    deleteRowsByValue(catches, "ref_id", rec.ref_id);
    species.forEach(function (sp) {
      let photoUrl = "";
      if (sp.photo_base64) photoUrl = uploadPhotoToDrive(sp.photo_base64, sp.sample_id);
      appendRowByHeader(catches, {
        ref_id: rec.ref_id,
        submitted_at: rec.submitted_at,
        checkin_date: rec.checkin_date,
        checkin_time: rec.checkin_time,
        trap_id: rec.trap_id,
        site: rec.site,
        deploy_time: rec.deploy_time,
        soak_mins: rec.soak_mins,
        gps_lat: rec.gps_lat,
        gps_lng: rec.gps_lng,
        species: sp.species || "",
        sci_name: sp.sci || "",
        count: sp.count || 1,
        length_cm: sp.length_cm || "",
        weight_g: sp.weight_g || "",
        flagged: sp.flagged || false,
        photo_url: photoUrl,
        clarity: rec.clarity || "",
        weather: rec.weather || "",
        water_temp_c: rec.water_temp_c || "",
        notes: rec.notes || "",
        observer: rec.observer || "",
        sample_id: sp.sample_id || ""
      });
    });
    upsertRowByHeader(checkins, summary, "ref_id", rec.ref_id);
    return jsonOut({ ok: true, ref_id: rec.ref_id, rows_written: species.length });
  } finally {
    lock.releaseLock();
  }
}


function uploadPhotoToDrive(base64, sampleId) {
  try {
    const folder = DriveApp.getFolderById(BYCATCH_FOLDER_ID);
    const filename = (sampleId || "photo") + "_photo.jpg";
    const matches = folder.getFilesByName(filename);
    if (matches.hasNext()) return matches.next().getUrl();
    const bytes = Utilities.base64Decode(base64);
    const blob = Utilities.newBlob(bytes, "image/jpeg", filename);
    const file = folder.createFile(blob);
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
    return file.getUrl();
  } catch (err) {
    Logger.log("uploadPhotoToDrive error: " + err);
    return "";
  }
}


const MUDPUPPY_HEADERS = [

  "id","trap_id","checkin_ref_id","site","catch_date",

  "individual_index","total_in_catch","photo_url",

  "sex","weight_g","svl_mm",

  "glochidia_present","glochidia_count",

  "swab_vial_id","pit_tag_id","tissue_vial_id",

  "notes","submitted_at","updated_at"

];



function handleMudpuppySave(obj) {

  const sh = getSheet("mudpuppies");

  ensureHeaders(sh, MUDPUPPY_HEADERS);

  const values = sh.getDataRange().getValues();

  const idCol = MUDPUPPY_HEADERS.indexOf("id"), photoCol = MUDPUPPY_HEADERS.indexOf("photo_url");

  let foundRowIdx = -1;

  for (let i = 1; i < values.length; i++) {

    if (String(values[i][idCol]) === String(obj.id)) { foundRowIdx = i; break; }

  }

  let photoUrl = obj.photo_url || "";

  if (obj.photo_base64) {

    // Mudpuppy photos also go to the same folder for consistency

    photoUrl = uploadPhotoToDrive(obj.photo_base64, obj.id);

  } else if (foundRowIdx >= 0) {

    photoUrl = values[foundRowIdx][photoCol];

  }

  const rec    = Object.assign({}, obj, { photo_url: photoUrl, updated_at: new Date().toISOString() });

  const rowArr = MUDPUPPY_HEADERS.map(function (h) {

    const v = rec[h]; return (v === undefined || v === null) ? "" : v;

  });

  if (foundRowIdx >= 0) {

    sh.getRange(foundRowIdx + 1, 1, 1, MUDPUPPY_HEADERS.length).setValues([rowArr]);

  } else {

    sh.appendRow(rowArr);

  }

  return jsonOut({ ok: true, photo_url: photoUrl });

}



// ============================================================

// CLEAR / ARCHIVE

// ============================================================

function handleClear() {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const stamp = new Date().toISOString();
    archiveSheet("deployments", "history_deployments", stamp);
    archiveSheet("checkins",   "history_checkins",   stamp);
    archiveSheet("catches",     "history_catches",     stamp);
    return jsonOut({ ok: true });
  } finally {
    lock.releaseLock();
  }
}


function archiveSheet(sourceName, historyName, stamp) {

  const src = getSheet(sourceName), values = src.getDataRange().getValues();

  if (values.length < 2) return;

  const headers = values[0], hist = getSheet(historyName);

  ensureHeaders(hist, headers.concat(["archived_at"]));

  for (let i = 1; i < values.length; i++) {

    if (values[i].every(function (v) { return v === ""; })) continue;

    hist.appendRow(values[i].concat([stamp]));

  }

  src.getRange(2, 1, src.getMaxRows() - 1, src.getMaxColumns()).clearContent();

}
