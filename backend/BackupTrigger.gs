/**
 * Karmto — สำรองข้อมูลอัตโนมัติทุกวัน
 *
 * ไฟล์นี้ไม่ได้รันเป็นส่วนหนึ่งของเว็บแอป (index.html) — ต้องคัดลอกไปวางในโปรเจกต์ Apps Script เดียวกับที่ deploy
 * เว็บแอป Karmto อยู่ (ตัวที่ URL ตรงกับ SHEET_API_URL ในไฟล์ index.html) เอง แล้วรันฟังก์ชันติดตั้งครั้งเดียว
 *
 * วิธีติดตั้ง (ทำครั้งเดียว):
 *   1. เปิด Google Sheet ที่ผูกกับ Karmto อยู่ -> เมนู "ส่วนขยาย" (Extensions) -> "Apps Script"
 *   2. ที่แถบไฟล์ด้านซ้าย กด "+" -> "Script" ตั้งชื่อไฟล์ว่า BackupTrigger (ชื่ออะไรก็ได้ ไม่มีผลกับโค้ด)
 *   3. ลบโค้ดเปล่าที่ขึ้นมาให้ทิ้ง แล้ววางโค้ดทั้งหมดในไฟล์นี้ลงไปแทน กด Ctrl+S / Cmd+S บันทึก
 *   4. ที่แถบเลือกฟังก์ชันด้านบน (ข้างปุ่ม ▶ รัน) เลือก "installKarmtoDailyBackupTrigger" แล้วกด ▶ รัน
 *      ครั้งแรกจะขึ้นขอสิทธิ์เข้าถึง Drive/เครือข่าย — กด "ตรวจสอบสิทธิ์" แล้วอนุญาตไปได้เลย (เป็นสิทธิ์ของบัญชี
 *      Google เดียวกับที่สร้าง Apps Script นี้เอง ไม่ใช่ส่งข้อมูลไปที่อื่น)
 *   5. เสร็จแล้ว — เช็คที่ "Executions" (แถบซ้ายของ Apps Script editor) ว่ารันผ่านไม่มี error
 *
 * จากนี้ไประบบจะรันเองอัตโนมัติทุกวันตอนตี 3 (ตามโซนเวลาของโปรเจกต์ Apps Script นี้ ปกติจะตรงกับโซนเวลาที่ตั้งค่า
 * ไว้ตอนสร้าง Google Sheet) ไม่ต้องทำอะไรต่อ — ไฟล์สำรองจะไปโผล่ที่โฟลเดอร์ "Karmto Backups" ใน Google Drive ของ
 * บัญชีที่รันฟังก์ชันนี้ (ไฟล์ .json ใหม่ 1 ไฟล์ต่อวัน เก็บย้อนหลัง 30 วัน เกินกว่านั้นลบไฟล์เก่าทิ้งอัตโนมัติกันพื้นที่เต็ม)
 *
 * อยากทดสอบทันทีไม่ต้องรอถึงตี 3: เลือกฟังก์ชัน "runDailyKarmtoBackup" แล้วกด ▶ รันตรงๆ ได้เลยเหมือนกัน
 *
 * ไฟล์ที่ได้กู้คืนกลับเข้าแอปได้เลยผ่านปุ่ม "นำเข้าข้อมูล" ที่มีอยู่แล้วในหน้าตั้งค่าของเว็บแอป (importAllData() ใน
 * index.html) — โครงสร้าง JSON ที่ไฟล์นี้สร้างตรงกับที่ exportAllData() ของเว็บแอปสร้างเป๊ะๆ
 */

// ต้องตรงกับ SHEET_API_URL ในไฟล์ index.html ของเว็บแอป (บรรทัดแรกๆ ของ <script type="module"> แรกสุด) — ถ้าเคย
// deploy เว็บแอปใหม่แล้ว URL เปลี่ยน ต้องมาแก้ตรงนี้ให้ตรงกันด้วย ไม่งั้น backup จะคุยกับ deployment เก่าที่ไม่มีแล้ว
var BACKUP_SHEET_API_URL = 'https://script.google.com/macros/s/AKfycbxBUioYu6BXMdc3Dmuy8XEQjc6DTW-oxivAT5yf3wWvQD-H50l32-dBZYq_XLTPbp2zBg/exec';

// root key อื่นๆ นอกจาก settings/days/debts ที่ต้องสำรองด้วย — ต้องตรงกับ BACKUP_EXTRA_ROOT_KEYS ใน index.html เป๊ะๆ
// (ถ้าแอปเพิ่ม root key ใหม่ในอนาคต ต้องมาเพิ่มในทั้งสองที่คู่กันเสมอ ไม่งั้น backup อัตโนมัติจะขาดข้อมูลส่วนใหม่ไปแบบเงียบๆ)
var BACKUP_EXTRA_ROOT_KEYS = ['rawLots', 'lotProductBills', 'lotTransportBills', 'wasteRecords', 'activityLog', 'billingRecheckCurrent', 'billingRecheckHistory', 'supplierShortfalls'];

var BACKUP_FOLDER_NAME = 'Karmto Backups';
var BACKUP_RETENTION_DAYS = 30; // เก็บไฟล์สำรองอัตโนมัติไว้ย้อนหลังกี่วัน เกินกว่านี้ลบทิ้งอัตโนมัติ กันพื้นที่ Drive เต็มไปเรื่อยๆ ตามอายุร้าน

/**
 * ฟังก์ชันหลักที่ trigger เรียกทุกวัน — ดึงข้อมูลทุกอย่างผ่าน API เดียวกับที่เว็บแอปใช้เป๊ะๆ (ไม่ได้อ่าน Sheet ตรงๆ
 * เลี่ยงการเดาโครงสร้างชีตภายใน) แล้วเขียนเป็นไฟล์ JSON ลง Drive
 */
function runDailyKarmtoBackup() {
  var listRes = backupFetch_('?action=list&prefix=day:');
  var dayKeys = listRes.keys || [];
  var allKeys = dayKeys.concat(['settings', 'debts']).concat(BACKUP_EXTRA_ROOT_KEYS);
  var bulkRes = backupFetch_(null, { action: 'bulkGet', keys: allKeys });
  var values = bulkRes.values || {};

  var days = {};
  dayKeys.forEach(function (k) {
    var raw = values[k];
    if (raw) {
      try { days[k] = JSON.parse(raw); }
      catch (e) { /* วันนี้ข้อมูลเสีย/parse ไม่ได้ ข้ามไปเฉยๆ กันทั้งก้อน backup พังเพราะวันเดียว */ }
    }
  });

  var payload = {
    exportedAt: new Date().toISOString(),
    settings: values.settings ? JSON.parse(values.settings) : null,
    days: days,
    debts: values.debts ? JSON.parse(values.debts) : [],
  };
  BACKUP_EXTRA_ROOT_KEYS.forEach(function (k) {
    payload[k] = values[k] ? JSON.parse(values[k]) : null;
  });

  var folder = backupGetOrCreateFolder_();
  var dateStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var fileName = 'karmto-backup-' + dateStr + '.json';
  folder.createFile(fileName, JSON.stringify(payload), MimeType.PLAIN_TEXT);

  backupPruneOldFiles_(folder);
}

/** เรียก API ของเว็บแอป Karmto ตัวเดียวกับที่ window.storage ใน index.html เรียก (GET ตอนมี queryString, POST ตอนมี postBody) */
function backupFetch_(queryString, postBody) {
  var options = postBody
    ? { method: 'post', contentType: 'text/plain;charset=utf-8', payload: JSON.stringify(postBody), muteHttpExceptions: true }
    : { method: 'get', muteHttpExceptions: true };
  var url = queryString ? (BACKUP_SHEET_API_URL + queryString) : BACKUP_SHEET_API_URL;
  var res = UrlFetchApp.fetch(url, options);
  var code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('Karmto backup: เรียก API ไม่สำเร็จ (HTTP ' + code + ') — ' + res.getContentText().slice(0, 300));
  }
  return JSON.parse(res.getContentText());
}

function backupGetOrCreateFolder_() {
  var it = DriveApp.getFoldersByName(BACKUP_FOLDER_NAME);
  if (it.hasNext()) return it.next();
  return DriveApp.createFolder(BACKUP_FOLDER_NAME);
}

function backupPruneOldFiles_(folder) {
  var cutoff = new Date(Date.now() - BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  var files = folder.getFilesByType(MimeType.PLAIN_TEXT);
  while (files.hasNext()) {
    var f = files.next();
    if (f.getName().indexOf('karmto-backup-') === 0 && f.getDateCreated() < cutoff) {
      f.setTrashed(true);
    }
  }
}

/** รันครั้งเดียวตอนติดตั้ง — ตั้ง trigger ให้ runDailyKarmtoBackup ทำงานเองทุกวันตอนตี 3 (idempotent: รันซ้ำกี่ครั้งก็ได้ ไม่สร้าง trigger ซ้ำซ้อน) */
function installKarmtoDailyBackupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runDailyKarmtoBackup') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runDailyKarmtoBackup').timeBased().atHour(3).everyDays(1).create();
  Logger.log('ตั้งเวลา backup อัตโนมัติทุกวันตอนตี 3 เรียบร้อย — ลองรัน runDailyKarmtoBackup() ตรงๆ ดูได้เลยถ้าอยากทดสอบก่อนไม่ต้องรอ');
}
