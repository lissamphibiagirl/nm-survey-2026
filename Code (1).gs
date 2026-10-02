/**
 * Fish Trap Survey — Apps Script backend
 * Deploy as: Web App, Execute as "Me", Access "Anyone"
 *
 * Required Script Properties:
 *   SHEET_ID        - Google Sheet ID (tabs: deployments, catches, mudpuppies)
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
function doGet(e) {
  const action = (e.parameter && e.parameter.action) || "";
  if (action === "today") {
    return jsonOut({
      ok:          true,
      deployments: readTodayRows("deployments", "deploy_date"),
      checkins:    readTodayRows("catches",     "checkin_date")
    });
  }
  if (action === "mudpuppies") {
    return jsonOut({ ok: true, mudpuppies: readAllRows("mudpuppies") });
  }
  return jsonOut({ ok: false, message: "Unknown action." });
}

function readAllRows(sheetName) {
  const sh = getSheet(sheetName), values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0], rows = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (row.every(function (v) { return v === ""; })) continue;
    const obj = {};
    headers.forEach(function (h, idx) { obj[h] = row[idx]; });
    rows.push(obj);
  }
  return rows;
}

function readTodayRows(sheetName, dateCol) {
  const sh = getSheet(sheetName), values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0], dateIdx = headers.indexOf(dateCol), today = todayStr(), rows = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (row.every(function (v) { return v === ""; })) continue;
    if (dateIdx >= 0 && String(row[dateIdx]) !== today) continue;
    const obj = {};
    headers.forEach(function (h, idx) { obj[h] = row[idx]; });
    rows.push(obj);
  }
  return rows;
}

// ============================================================
// doPost
// ============================================================
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
  const sh = getSheet("deployments");
  ensureHeaders(sh, ["ref_id","submitted_at","trap_id","site","deploy_date","deploy_time","gps_lat","gps_lng","notes"]);
  appendRowByHeader(sh, rec);
  return jsonOut({ ok: true });
}

// ============================================================
// CHECK-IN
// One row per species. Includes species name, count, length, weight,
// and a photo URL (uploaded to the dedicated Drive folder).
// ============================================================
function handleCheckin(rec) {
  const sh = getSheet("catches");
  ensureHeaders(sh, [
    "ref_id","submitted_at","checkin_date","checkin_time",
    "trap_id","site","deploy_time","soak_mins",
    "gps_lat","gps_lng",
    "species","sci_name",
    "count","length_cm","weight_g",
    "flagged","photo_url",
    "clarity","weather","water_temp_c",
    "notes","observer","sample_id"
  ]);

  const species = rec.species || [];
  species.forEach(function (sp) {
    // Upload photo to the dedicated bycatch Drive folder
    let photoUrl = "";
    if (sp.photo_base64) {
      photoUrl = uploadPhotoToDrive(sp.photo_base64, sp.sample_id);
    }
    appendRowByHeader(sh, {
      ref_id:       rec.ref_id,
      submitted_at: rec.submitted_at,
      checkin_date: rec.checkin_date,
      checkin_time: rec.checkin_time,
      trap_id:      rec.trap_id,
      site:         rec.site,
      deploy_time:  rec.deploy_time,
      soak_mins:    rec.soak_mins,
      gps_lat:      rec.gps_lat,
      gps_lng:      rec.gps_lng,
      species:      sp.species   || "",
      sci_name:     sp.sci       || "",
      count:        sp.count     || 1,
      length_cm:    sp.length_cm || "",
      weight_g:     sp.weight_g  || "",
      flagged:      sp.flagged   || false,
      photo_url:    photoUrl,
      clarity:      rec.clarity      || "",
      weather:      rec.weather      || "",
      water_temp_c: rec.water_temp_c || "",
      notes:        rec.notes        || "",
      observer:     rec.observer     || "",
      sample_id:    sp.sample_id     || ""
    });
  });
  return jsonOut({ ok: true, rows_written: species.length });
}

// ============================================================
// PHOTO UPLOAD — dedicated bycatch Drive folder
// ============================================================
function uploadPhotoToDrive(base64, sampleId) {
  try {
    const folder   = DriveApp.getFolderById(BYCATCH_FOLDER_ID);
    const bytes    = Utilities.base64Decode(base64);
    const filename = (sampleId || "photo") + "_" +
                     Utilities.formatDate(new Date(), "America/Chicago", "yyyyMMdd_HHmmss") + ".jpg";
    const blob     = Utilities.newBlob(bytes, "image/jpeg", filename);
    const file     = folder.createFile(blob);
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
    return file.getUrl();
  } catch (err) {
    Logger.log("uploadPhotoToDrive error: " + err);
    return "";
  }
}

// ============================================================
// MUDPUPPY METADATA — upserted by id
// ============================================================
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
  const stamp = new Date().toISOString();
  archiveSheet("deployments", "history_deployments", stamp);
  archiveSheet("catches",     "history_catches",     stamp);
  return jsonOut({ ok: true });
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
