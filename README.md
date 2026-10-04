# Fish Trap Survey

## Deploy the website to the new GitHub repository

Upload these website files to the repository root and enable GitHub Pages:

- `index.html`
- `app.js`
- `config.js`
- `db.js`
- `species-data.js`
- `style.css`
- `manifest.json`
- `icon.svg`
- `sw.js`

`nm_season_2026 (1).xlsx` is a reference workbook and is not required by the web app. `Code.gs` is the Google Apps Script backend; add it in the Apps Script editor rather than relying on GitHub Pages to run it.

Before leaving the old site, let any pending records upload. Browser records are stored under the site's web origin; records will not carry over automatically if the new Pages site uses a different origin.

## Update the Apps Script backend

1. Open the Apps Script project used by this survey and replace its code with `Code.gs`.
2. Confirm the Script Property `SHEET_ID` contains the spreadsheet ID.
3. Deploy a new Web App version with **Execute as: Me** and access set to **Anyone**. If the Web App URL changes, update `APPS_SCRIPT_URL` in `config.js`.

The script creates a `checkins` sheet for one summary row per trap check-in, including check-ins with no fish. Species rows remain in `catches`. Deployments and check-ins stay visible in the app until you use **Clear all traps / new survey week**; clearing archives deployments, check-ins, and catches into history sheets.

## Date and time fields

Deployment and check-in forms each include editable date and time fields, defaulted to the current local date and time. The soak duration uses the selected deployment and check-in timestamps, including across multiple dates. A check-in earlier than its deployment is rejected; choose a valid order of events.

## Sync behavior

The app attempts each queued record once per sync pass. It starts a pass after a record is saved, when the connection returns, and when the app opens. It does not poll on a timer or sync again on focus changes. Failed records remain on the device and can be retried after reconnecting, reopening the app, or when another record starts a sync pass. The Apps Script uses record IDs to make retry uploads safe.

After a trap check-in, the app shows an upload receipt. The next check-in is held until the previous upload succeeds and you choose **Check next trap**. If an upload is still pending, the receipt stays visible and the next check-in remains blocked.

## Repeated daily check-ins (version 4)

Trap choices are MP-01 through MP-100. Deploy each trap once. It remains available for repeated check-ins on any date, including multiple checks in one day. Each submission has a separate record ID. Existing trap IDs are preserved rather than renamed.

All check-ins remain in history until Clear is used. Open a trap or expand a dated history entry to review species, counts, measurements, observer and notes. Time shown is total time since the original deployment, not the interval between checks. Clear archives data in the spreadsheet; it does not run at midnight.

IMPORTANT: Update both the website files and Code.gs. Publish a new version of the existing Apps Script deployment. The new website requests the all-days survey endpoint; an old backend cannot supply it. Keep the existing deployment URL in config.js when updating the same deployment. Reload the website after upload to get the new service worker. Do not clear browser data while uploads are pending.

## Readable field layout (version 5)

Larger system fonts, high-contrast light and night palettes, spacious cards, and larger buttons. New users start in light mode; a saved theme preference is respected. Pinch zoom is enabled. Website-only visual update: replace the website files in the same repository. The version 4 Apps Script is unchanged; if already deployed, it does not need another deployment for this visual update.

## Delete incorrect or test records (version 6)

Update both the website files and Code.gs, then publish a new version of your existing Apps Script deployment.

- Open a deployment to delete it and its linked check-ins, catches and specimen records.
- Expand a dated catch-history entry to delete that check-in and its linked catches and specimen records.
- Open a mudpuppy record to delete its individual metadata; this does not change the original check-in catch count. Delete and re-enter a check-in to correct its catch counts.
- In the Deploy tab, expand Testing & data cleanup. Delete all survey data requires typing DELETE ALL. It removes current and archived survey rows, including real data, and pending records on the current device. Sheet headers and unrelated tabs remain.

Deletion requires internet, is permanent, and keeps Drive photo files. Other devices must upload or discard their pending records before cleanup, or those records may upload later. The existing Clear all traps action still archives rather than permanently deleting. No records are deleted merely by installing this update.

## Site measurements and section boxes (version 7)

Weather remains Sunny/Overcast/Rain. Clarity choices are removed. Check-ins now have optional air temperature at site (°C), water temperature (°C), and water pH (0–14). Blank means not measured, and zero is preserved. Values reset for each new check-in and appear in its history. Existing clarity data remains in the spreadsheet.

Update Code.gs and deploy a new version of the existing deployment as well as replacing the website files. The script adds missing measurement columns without moving existing data. Phone forms use separate outlined section boxes, larger headings and inputs, and vertically stacked date/time fields.

## University workflow (version 8)

Update all website files, including research.js and DATA_DICTIONARY.csv. Replace Code.gs and publish a new version of your existing deployment. The app checks backend compatibility before writing or deleting data.

- Research mode keeps existing data and browser storage. Switch to Practice using the dataset banner. Practice uses a separate browser database, receipt, and test_ spreadsheet tabs. Mode changes reload the app and discard unsaved form edits; queued records remain in their original dataset. Practice photos have a test_ filename prefix but use the existing Drive folder.
- Configure project title, institution, research team and protocol version under Project details & exports. These settings are local to the device and attached to new deployments/check-ins. No university branding or approval has been assumed.
- Review deployments and check-ins before confirming. Observer name is required on check-ins. Empty catch submissions explicitly record no_animals_caught. Each fish species needs a positive integer count.
- Dashboard counts show deployed traps, checked today, still to check today and pending uploads. Reload across midnight to refresh today's labels; daily history is never cleared automatically.
- Sampling interval is recorded separately from total deployment duration. It uses the latest earlier check known at entry. Backdated records do not automatically revise previously stored intervals; verify chronological sampling intervals in analysis.
- Correct this record opens an audited editor for deployment site/notes, check-in observer/weather/measurements/notes, or specimen metadata. An author and reason are required. Corrections are stored as append-only rows with original JSON and patch JSON; original measurement rows are preserved. The app shows corrected values, while raw source spreadsheet rows retain originals. Use app exports for corrected check-in data. Dates, trap links and catch counts are not editable in this correction dialog.
- Existing specimen data-entry saves and permanent deletions remain available; they are not a comprehensive audit trail of every possible change. Self-reported authors are not authenticated identities. This version does not add university access control or formal compliance certification.
- CSV downloads cover currently loaded records in the selected dataset, with upload_status. Pending records are included, and archived data remains in the Google Sheet history tabs. Correction logs can be exported separately. CSV files protect text beginning with spreadsheet formula characters.
- Full deletion affects only the selected dataset and includes its correction log. Practice cleanup does not affect research tabs. Photos remain in Drive. On other devices, pending records can upload later, so coordinate cleanup before field use.

Verification: automated checks cover dataset isolation, correction history and conflict handling, measurement validation and source syntax. Full browser/device and live Google deployment testing remain to be performed before field collection.

## Minimal interface (version 9)

CSV export buttons and download code have been removed. Entries still upload automatically to Google Sheets after review and saving. Today's progress is collapsed, and dataset switching, project details and cleanup live under Settings. Backend version 8 remains compatible; this visual update does not require redeploying an already-current Code.gs.

Access has NOT been restricted by this update. GitHub Pages and the existing Apps Script endpoint have separate access controls. An owner-only Apps Script-hosted UI is a possible migration, but requires replacing the GitHub fetch workflow with authenticated Apps Script calls. Do not simply restrict the backend and expect the current cross-origin app to continue syncing. Existing Drive photos may also have link-sharing permissions.

## Modern visual refinement (version 10)

A slate and teal palette, consistent outlined section cards, system typography, restrained status badges and large touch controls. Em dashes have been removed from app interface text. Automatic uploads and dataset behavior are unchanged. Replace website files only if backend version 8 is already deployed.
