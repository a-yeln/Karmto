# backend/

`index.html` is a static frontend with no server code in this repo — the real
backend is a Google Apps Script web app, deployed separately (its URL is
`SHEET_API_URL` near the top of `index.html`). This folder holds reference
code meant to be installed *inside that Apps Script project*, not run from
here — nothing in this repo can deploy or execute it.

## BackupTrigger.gs

Sets up an automated daily backup: a time-driven Apps Script trigger that
calls the same API `index.html`'s `window.storage` already uses, gathers
every root data key, and writes a dated JSON snapshot to a "Karmto Backups"
folder in Google Drive (keeping the last 30 days, pruning older ones).

Full install steps are in the comment block at the top of the file itself —
copy it into the Apps Script editor (Extensions → Apps Script from the Sheet
the app is backed by) and run `installKarmtoDailyBackupTrigger` once.

The resulting JSON files restore through the app's existing "นำเข้าข้อมูล"
(import) button — same format `exportAllData()` produces, so the two stay
interchangeable. If the app ever adds a new root-level storage key, update
`BACKUP_EXTRA_ROOT_KEYS` in **both** `index.html` and this file together, or
the automated backup will silently miss it.

## AuthGuard.gs

Adds a passcode check to the web app API so someone who finds the `/exec` URL in the public
page source can't read or change data. The passcode is never in `index.html`: each device
enters it once in **ตั้งค่า → 🔐 รหัสเข้าใช้ระบบ** and keeps it locally; the server compares
it with the `KARMTO_KEY` Script Property. Until that property is set nothing is enforced.
Install steps are in the comment at the top of the file (set the passcode on every device
first, then add the property and the one-line guard to `doGet`/`doPost`, then redeploy).
`BackupTrigger.gs` sends the same key automatically.
