/**
 * Karmto — บอท LINE กลุ่มแบบเงียบ (โปรเจกต์ Apps Script แยก ไม่ใช่โปรเจกต์เดียวกับ Code.gs)
 *
 * ทำอะไร:
 *  - รูปสลิปในกลุ่ม → อ่านยอด/วันที่/เวลา/ผู้โอน (OCR ฟรีของ Google Drive) → เก็บลงคีย์ lineInbox:YYYY-MM-DD
 *    ให้แอปโชว์ในการ์ด "จับคู่ยอดโอน" (แท็บบิล) — AY เลือกบิลและกดยืนยันเองทุกครั้ง บอทไม่ติ๊กจ่าย/ไม่บันทึกเงิน
 *  - ข้อความตัวอักษรในกลุ่ม → เก็บลง lineInbox (type 'text') + ถ้าตั้ง LINE_NOTIFY_USER_ID จะส่งแจ้ง AY ทางแชทส่วนตัว
 *  - รูปที่ไม่ใช่สลิป (ออเดอร์/บิล) → ข้าม ไม่เก็บ
 *  - ไม่ตอบ/ไม่ส่งอะไรในกลุ่มเด็ดขาด (ไม่มีการเรียก reply และไม่ push เข้ากลุ่ม)
 *
 * ขั้นตอนติดตั้งสำหรับ AY (ทำครั้งเดียว):
 *  1) LINE Developers (developers.line.biz) → สร้าง Provider → สร้าง Messaging API channel (ผูกกับ LINE OA ใหม่หรือของเดิม)
 *     - แท็บ Messaging API: กด Issue "Channel access token (long-lived)" → คัดลอกไว้
 *     - LINE Official Account Manager → ตั้งค่า → การตอบกลับ: ปิด "ข้อความตอบกลับอัตโนมัติ" และ "ข้อความทักทาย"
 *       เปิด "Webhook" และเปิด "อนุญาตให้บอทเข้าร่วมกลุ่ม"
 *  2) script.google.com → New project → ตั้งชื่อ "Karmto LINE Bot" → วางไฟล์นี้ทั้งไฟล์แทน Code.gs เปล่า
 *  3) เมนูซ้าย Services (+) → เพิ่ม "Drive API" (ใช้ OCR อ่านสลิปฟรี) → Add
 *  4) Project Settings → Script Properties → เพิ่ม:
 *       LINE_CHANNEL_ACCESS_TOKEN = token จากข้อ 1
 *       LINE_WEBHOOK_TOKEN        = รหัสสุ่มยาวอย่างน้อย 24 ตัว (ตัวอักษร+ตัวเลข) ตั้งเอง ห้ามบอกใคร — สั้นกว่านี้บอทไม่รับอะไรเลย
 *       KARMTO_API_URL            = ลิงก์ /exec ของเว็บแอป Karmto ตัวเดิม (ค่าเดียวกับ SHEET_API_URL ใน index.html)
 *       KARMTO_KEY                = รหัสเข้าใช้ระบบ (ถ้าตั้งไว้ตาม AuthGuard.gs — ไม่ได้ตั้งก็ไม่ต้องใส่)
 *  5) Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone → Deploy → อนุญาตสิทธิ์ → คัดลอกลิงก์ /exec
 *  6) กลับไป LINE Developers → Messaging API → Webhook URL = ลิงก์ /exec จากข้อ 5 ต่อท้ายด้วย ?t=รหัสจากข้อ 4
 *       เช่น https://script.google.com/macros/s/xxxx/exec?t=รหัสสุ่ม  → เปิด Use webhook
 *     (ปุ่ม Verify อาจขึ้น error เพราะ Apps Script ตอบกลับแบบ redirect — ไม่เป็นไร ข้อความจริงยังเข้า)
 *  7) ในโปรแกรมแก้สคริปต์ เลือกฟังก์ชัน installKarmtoLineBot → Run ครั้งเดียว (ตั้งตัวประมวลผลทุก 1 นาที)
 *  8) เชิญบอทเข้ากลุ่ม LINE → ส่งรูปอะไรก็ได้ 1 รูป → รัน showKarmtoLineGroups ดู Group ID ใน Execution log (เลือกตัวท้ายสุดที่เพิ่งขึ้นหลังส่งรูป)
 *     → เพิ่ม Script Property  LINE_GROUP_ID = Group ID นั้น (หลังตั้งแล้วบอทรับเฉพาะกลุ่มนี้กลุ่มเดียว)
 *  ไม่บังคับ: LINE_NOTIFY_USER_ID = User ID ของ AY (LINE Developers → Basic settings → Your user ID)
 *     ตั้งแล้วบอทจะส่งแจ้งทางแชทส่วนตัวเมื่อมีคนพิมพ์ข้อความในกลุ่ม (ใช้โควตา push ของแพ็กเกจ LINE OA — ไม่ตั้ง = ไม่ส่ง)
 *
 * ความปลอดภัย: Apps Script อ่าน header X-Line-Signature ไม่ได้ (ข้อจำกัดของ Google) จึงกันด้วย
 *  (ก) รหัสลับ ?t= ในลิงก์ webhook (ข) รับเฉพาะ LINE_GROUP_ID (ค) รูปดึงจากเซิร์ฟเวอร์ LINE ด้วย token ของเราเองเท่านั้น
 *  ใครปลอมคำขอมาก็ได้แค่ messageId ที่ LINE ไม่รู้จัก → ดึงรูปไม่ได้ → ไม่มีอะไรถูกบันทึก
 */

var LINE_QUEUE_PROP = 'LINE_QUEUE';
var LINE_QUEUE_MAX = 300;
var LINE_QUEUE_MAX_BYTES = 8500; // ค่าใน Script Properties ได้ไม่เกิน ~9KB ต่อค่า
var LINE_MAX_TRIES = 3;
var LINE_RAW_TEXT_MAX = 300;
var LINE_TZ = 'Asia/Bangkok';

// ============ webhook: รับเร็ว ใส่คิว ตอบ 200 — ไม่ประมวลผลหนักตรงนี้ ============
function doPost(e) {
  var props = PropertiesService.getScriptProperties();
  var want = props.getProperty('LINE_WEBHOOK_TOKEN');
  var got = (e && e.parameter && e.parameter.t) || '';
  if (!want || want.length < 24 || got !== want) return lineOk_(); // ไม่บอกผู้เรียกว่าผิดอะไร; รหัสสั้นเกิน = ไม่รับเลย
  var body;
  try { body = JSON.parse((e.postData && e.postData.contents) || '{}'); } catch (err) { return lineOk_(); }
  var allowGroup = props.getProperty('LINE_GROUP_ID') || '';
  var items = [];
  (body.events || []).forEach(function (ev) {
    if (!ev || ev.type !== 'message' || !ev.message || !ev.source || ev.source.type !== 'group') return;
    var gid = String(ev.source.groupId || '');
    if (!/^C[0-9a-f]{32}$/.test(gid)) return;
    var uid = String(ev.source.userId || '');
    if (uid && !/^U[0-9a-f]{32}$/.test(uid)) return;
    if (!allowGroup) { lineRememberGroup_(props, gid); return; } // ยังไม่ตั้งกลุ่ม: จำ ID ไว้ให้ AY ดู ไม่เก็บอะไร
    if (gid !== allowGroup) return;
    var mid = String(ev.message.id || '');
    if (!/^\d{1,30}$/.test(mid)) return;
    // ใช้เวลาที่รับจริง ไม่เชื่อ timestamp ใน event (ผู้ยิงกำหนดเองได้)
    var base = { mid: mid, ts: Date.now(), uid: uid, gid: gid, tries: 0 };
    if (ev.message.type === 'image') { base.kind = 'image'; items.push(base); }
    else if (ev.message.type === 'text') { base.kind = 'text'; base.text = String(ev.message.text || '').slice(0, 300); items.push(base); }
  });
  if (items.length) lineQueuePush_(items);
  return lineOk_();
}
function doGet() { return lineOk_(); }
function lineOk_() {
  return ContentService.createTextOutput('{"ok":true}').setMimeType(ContentService.MimeType.JSON);
}
function lineRememberGroup_(props, gid) {
  var seen = (props.getProperty('LINE_SEEN_GROUP_IDS') || '').split(',').filter(String);
  if (seen.indexOf(gid) < 0) { seen.push(gid); props.setProperty('LINE_SEEN_GROUP_IDS', seen.slice(-10).join(',')); }
}
/** รันเองหลังเชิญบอทเข้ากลุ่ม → ดู Group ID ใน Execution log */
function showKarmtoLineGroups() {
  Logger.log('Group ID ที่บอทเห็น: ' + (PropertiesService.getScriptProperties().getProperty('LINE_SEEN_GROUP_IDS') || '(ยังไม่มี — ส่งรูปในกลุ่มก่อน 1 รูป)'));
}

function lineQueuePush_(items) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var props = PropertiesService.getScriptProperties();
    var q = lineQueueRead_(props);
    var have = {};
    q.forEach(function (x) { have[x.mid] = 1; });
    items.forEach(function (x) { if (!have[x.mid]) q.push(x); });
    if (q.length > LINE_QUEUE_MAX) q = q.slice(q.length - LINE_QUEUE_MAX);
    try { lineQueueWrite_(props, q); } catch (err) { Logger.log('Karmto LINE: เขียนคิวไม่ได้ ' + (err && err.message)); }
  } finally { lock.releaseLock(); }
}
function lineQueueWrite_(props, q) {
  var s = JSON.stringify(q);
  while (q.length > 1 && lineBytes_(s) > LINE_QUEUE_MAX_BYTES) { // ล้นจริง (คิวค้างนาน) → ทิ้งข้อความตัวอักษรก่อน แล้วค่อยของเก่าสุด
    var i = -1;
    for (var k = 0; k < q.length; k++) if (q[k].kind === 'text') { i = k; break; }
    Logger.log('Karmto LINE: คิวเต็ม ทิ้ง ' + q[i >= 0 ? i : 0].mid);
    q.splice(i >= 0 ? i : 0, 1);
    s = JSON.stringify(q);
  }
  props.setProperty(LINE_QUEUE_PROP, s);
}
function lineBytes_(s) { return unescape(encodeURIComponent(s)).length; }
function lineQueueRead_(props) {
  try { var q = JSON.parse(props.getProperty(LINE_QUEUE_PROP) || '[]'); return Array.isArray(q) ? q : []; }
  catch (e) { return []; }
}

// ============ ตัวประมวลผล (trigger ทุก 1 นาที) ============
function processKarmtoLineQueue() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return; // รอบก่อนยังทำไม่เสร็จ
  var started = Date.now();
  try {
    var props = PropertiesService.getScriptProperties();
    var cache = CacheService.getScriptCache();
    while (Date.now() - started < 4 * 60 * 1000) {
      var q = lineQueueRead_(props);
      if (!q.length) break;
      var it = q[0];
      var ok = false;
      if (cache.get('done:' + it.mid)) ok = true; // เคยทำแล้ว (กันซ้ำ)
      else {
        try { lineHandleItem_(it, props); ok = true; cache.put('done:' + it.mid, '1', 21600); }
        catch (err) { Logger.log('Karmto LINE: ' + it.mid + ' ' + (err && err.message)); }
      }
      // อ่านคิวใหม่อีกรอบก่อนเขียน (doPost อาจเพิ่มของเข้ามาระหว่างนี้ — ใช้ lock เดียวกัน จึงไม่ชนกัน แต่เผื่อไว้)
      q = lineQueueRead_(props);
      var idx = -1;
      for (var i = 0; i < q.length; i++) if (q[i].mid === it.mid) { idx = i; break; }
      if (idx >= 0) {
        if (ok) q.splice(idx, 1);
        else { q[idx].tries = (q[idx].tries || 0) + 1; var bad = q.splice(idx, 1)[0]; if (bad.tries < LINE_MAX_TRIES) q.push(bad); }
      }
      lineQueueWrite_(props, q);
      if (!ok) break; // พังแล้วพักไว้รอบหน้า (เน็ต/โควตา)
    }
  } finally { lock.releaseLock(); }
}

function lineHandleItem_(it, props) {
  var token = props.getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token) throw new Error('ยังไม่ได้ตั้ง LINE_CHANNEL_ACCESS_TOKEN');
  var day = Utilities.formatDate(new Date(it.ts), LINE_TZ, 'yyyy-MM-dd');
  var at = Utilities.formatDate(new Date(it.ts), LINE_TZ, "yyyy-MM-dd'T'HH:mm:ss");
  var who = lineMemberName_(token, it.gid, it.uid);
  if (it.kind === 'text') {
    // ข้อความไม่มีของให้ดึงยืนยันจาก LINE — ต้องเป็นสมาชิกจริงของกลุ่ม (LINE ตอบชื่อได้) ไม่งั้นทิ้ง ไม่เก็บ ไม่แจ้ง
    if (!who) return;
    karmtoInboxPush_(day, { id: 'L' + it.mid, type: 'text', at: at, postedBy: who, text: String(it.text || '').slice(0, 500) });
    var notifyTo = props.getProperty('LINE_NOTIFY_USER_ID');
    var cache = CacheService.getScriptCache();
    if (notifyTo && !cache.get('notified:' + it.mid)) {
      cache.put('notified:' + it.mid, '1', 21600);
      linePushToOwner_(token, notifyTo, '💬 ' + who + ' พิมพ์ในกลุ่ม (อย่าโอนเงินตามข้อความนี้ ดูในกลุ่มเอง): ' + String(it.text || '').slice(0, 300));
    }
    return;
  }
  var res = UrlFetchApp.fetch('https://api-data.line.me/v2/bot/message/' + encodeURIComponent(it.mid) + '/content', {
    headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  if (code === 404 || code === 410) return; // ไม่มีรูปนี้ (หมดอายุ/ปลอม) — จบ ไม่เก็บอะไร
  if (code < 200 || code >= 300) throw new Error('ดึงรูปไม่ได้ HTTP ' + code);
  var blob = res.getBlob();
  if (!/^image\//.test(String(blob.getContentType())) || blob.getBytes().length > 10 * 1024 * 1024) return; // ไม่ใช่รูป/ใหญ่เกิน → ข้าม
  var text = lineOcr_(blob);
  var slip = parseSlipText_(text);
  if (!slip.isSlip) return; // รูปออเดอร์/บิล/อื่นๆ → ข้าม
  karmtoInboxPush_(day, {
    id: 'L' + it.mid, type: 'slip', at: at, postedBy: who,
    amount: slip.amount, amountCands: slip.amountCands, slipDate: slip.date, slipTime: slip.time,
    sender: slip.sender, receiver: slip.receiver, bank: slip.bank, ref: slip.ref,
    text: String(text || '').replace(/\s+/g, ' ').replace(/\d{6,}/g, function (d) { return 'x'.repeat(d.length - 4) + d.slice(-4); }).slice(0, LINE_RAW_TEXT_MAX), // ปิดเลขบัญชี/เลขยาว
  });
}

// OCR ฟรีของ Google Drive: อัปโหลดรูปแบบแปลงเป็น Google Docs (ภาษาไทย) → อ่านข้อความ → ทิ้งไฟล์
function lineOcr_(blob) {
  blob.setName('karmto-slip-' + Date.now() + '.jpg');
  var id;
  if (Drive.Files.insert) { // Drive API v2
    id = Drive.Files.insert({ title: blob.getName(), mimeType: blob.getContentType() }, blob, { ocr: true, ocrLanguage: 'th' }).id;
  } else { // Drive API v3
    id = Drive.Files.create({ name: blob.getName(), mimeType: 'application/vnd.google-apps.document' }, blob, { ocrLanguage: 'th' }).id;
  }
  try { return DocumentApp.openById(id).getBody().getText() || ''; }
  finally { // ลบถาวร (ไม่ค้างถังขยะ 30 วัน)
    try { Drive.Files.remove(id); } catch (e) { try { DriveApp.getFileById(id).setTrashed(true); } catch (e2) {} }
  }
}

function lineMemberName_(token, gid, uid) {
  if (!uid) return null;
  try {
    var r = UrlFetchApp.fetch('https://api.line.me/v2/bot/group/' + encodeURIComponent(gid) + '/member/' + encodeURIComponent(uid), {
      headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true,
    });
    if (r.getResponseCode() !== 200) return null;
    return String(JSON.parse(r.getContentText()).displayName || '').slice(0, 60) || null;
  } catch (e) { return null; }
}
// ส่งหา AY ทางแชทส่วนตัวเท่านั้น (to = User ID ของ AY) — ไม่มีโค้ดส่งเข้ากลุ่ม
function linePushToOwner_(token, userId, text) {
  if (!/^U[0-9a-f]{32}$/.test(String(userId))) return;
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ to: userId, messages: [{ type: 'text', text: String(text).slice(0, 1000) }] }),
  });
}

// เขียนแบบ patch ทีละรายการ (push เข้าอาเรย์ของคีย์วัน) ผ่าน API เดียวกับที่แอปใช้ — ไม่โหลดทั้งก้อนแล้วเขียนทับ
function karmtoInboxPush_(day, item) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('KARMTO_API_URL');
  if (!url) throw new Error('ยังไม่ได้ตั้ง KARMTO_API_URL');
  // ลบ id เดิม (ถ้ามี) แล้ว push ในคำขอเดียว — ลองใหม่หลังเน็ตหลุดกี่ครั้งก็ไม่เกิดรายการซ้ำ
  var body = { action: 'patchOps', key: 'lineInbox:' + day, ops: [{ arrayPath: [], remove: { matchField: 'id', matchValue: item.id } }, { arrayPath: [], push: item }], rootIsArray: true };
  var key = props.getProperty('KARMTO_KEY');
  if (key) body.k = key;
  var res = UrlFetchApp.fetch(url, { method: 'post', contentType: 'text/plain;charset=utf-8', payload: JSON.stringify(body), muteHttpExceptions: true });
  var code = res.getResponseCode();
  if (code < 200 || code >= 300) throw new Error('บันทึก lineInbox ไม่ได้ HTTP ' + code);
  var data = JSON.parse(res.getContentText());
  if (data && data.error) throw new Error('บันทึก lineInbox ไม่ได้: ' + data.error);
}

// ============ ตัวอ่านข้อความสลิป (ฟังก์ชันล้วน — เทสได้ใน Node) ============
// ไม่เดา: ยอดต้องมีป้าย (จำนวน/จำนวนเงิน/ยอดโอน) หรือคำว่า บาท/THB ติดกัน; ถ้าได้หลายยอดที่ต่างกันจริง → amount = null
// ให้ AY ดูเอง (amountCands บอกยอดที่เจอ) — ค่าธรรมเนียม/ยอดคงเหลือ ไม่นับ
var SLIP_TH_MONTHS = { 'ม.ค.': 1, 'ก.พ.': 2, 'มี.ค.': 3, 'เม.ย.': 4, 'พ.ค.': 5, 'มิ.ย.': 6, 'ก.ค.': 7, 'ส.ค.': 8, 'ก.ย.': 9, 'ต.ค.': 10, 'พ.ย.': 11, 'ธ.ค.': 12 };
var SLIP_EN_MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
var SLIP_BANKS = [
  ['กสิกร', 'กสิกรไทย'], ['K PLUS', 'กสิกรไทย'], ['KBANK', 'กสิกรไทย'], ['ไทยพาณิชย์', 'ไทยพาณิชย์'], ['SCB', 'ไทยพาณิชย์'],
  ['กรุงไทย', 'กรุงไทย'], ['Krungthai', 'กรุงไทย'], ['กรุงเทพ', 'กรุงเทพ'], ['Bangkok Bank', 'กรุงเทพ'], ['กรุงศรี', 'กรุงศรี'],
  ['ทีทีบี', 'ทีทีบี'], ['ttb', 'ทีทีบี'], ['ออมสิน', 'ออมสิน'], ['MyMo', 'ออมสิน'], ['ธ.ก.ส.', 'ธ.ก.ส.'], ['พร้อมเพย์', 'พร้อมเพย์'], ['PromptPay', 'พร้อมเพย์'],
];

function parseSlipText_(raw) {
  var text = String(raw || '').replace(/\r/g, '').replace(/[ \t ]+/g, ' ');
  var lines = text.split('\n').map(function (l) { return l.trim(); }).filter(String);
  var out = { isSlip: false, amount: null, amountCands: [], date: null, time: null, sender: null, receiver: null, bank: null, ref: null };
  var looksSlip = /(โอนเงินสำเร็จ|โอนเงิน|ชำระเงินสำเร็จ|รายการสำเร็จ|ทำรายการสำเร็จ|จ่ายบิลสำเร็จ|เลขที่รายการ|รหัสอ้างอิง|หมายเลขอ้างอิง|Transaction|Transfer|Ref\.?\s?No|พร้อมเพย์|PromptPay)/i.test(text);

  var NUM = '(\\d{1,3}(?:,\\d{3})+(?:\\.\\d{1,2})?|\\d+(?:\\.\\d{1,2})?)';
  var cands = [];
  var skip = /(ค่าธรรมเนียม|fee|คงเหลือ|balance|เลขที่|อ้างอิง|ref|บัญชี|account|xxx)/i;
  lines.forEach(function (l, i) {
    if (skip.test(l)) return;
    var m;
    var re1 = new RegExp(NUM + '\\s*(?:บาท|THB|฿)', 'gi');
    while ((m = re1.exec(l))) cands.push(m[1]);
    var re2 = new RegExp('(?:฿|THB)\\s*' + NUM, 'gi');
    while ((m = re2.exec(l))) cands.push(m[1]);
    if (/^(จำนวน(เงิน)?|ยอดโอน|ยอดเงิน|Amount)/i.test(l)) {
      var same = l.match(new RegExp(NUM + '\\s*$'));
      if (same) cands.push(same[1]);
      else if (lines[i + 1] && !skip.test(lines[i + 1])) {
        var nx = lines[i + 1].match(new RegExp('^' + NUM + '(?:\\s*(?:บาท|THB|฿))?$', 'i'));
        if (nx) cands.push(nx[1]);
      }
    }
  });
  var uniq = [];
  cands.forEach(function (c) {
    var n = Math.round(Number(String(c).replace(/,/g, '')) * 100) / 100;
    if (n > 0 && n < 10000000 && uniq.indexOf(n) < 0) uniq.push(n);
  });
  out.amountCands = uniq;
  if (uniq.length === 1) out.amount = uniq[0];

  // วันที่: 12 พ.ย. 69 / 12 พ.ย. 2569 / 12 Nov 2026 / 12/11/2569 / 12/11/26
  var d = null, m2;
  if ((m2 = text.match(/(\d{1,2})\s*(ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)\s*(\d{2,4})/))) d = [m2[1], SLIP_TH_MONTHS[m2[2]], m2[3]];
  else if ((m2 = text.match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{2,4})/i))) d = [m2[1], SLIP_EN_MONTHS[m2[2].toLowerCase().slice(0, 3)], m2[3]];
  else if ((m2 = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/))) d = [m2[1], m2[2], m2[3]];
  if (d) out.date = slipIso_(Number(d[0]), Number(d[1]), d[2]);
  // เวลา: ต้องมี ":" หรือลงท้าย "น." เท่านั้น (กัน 20.00 บาท ถูกอ่านเป็น 20:00)
  var t = text.match(/(?:^|[^\d.,])([01]?\d|2[0-3]):([0-5]\d)(?![\d])/m) || text.match(/(?:^|[^\d.,])([01]?\d|2[0-3])\.([0-5]\d)\s*น\./m);
  if (t) out.time = ('0' + t[1]).slice(-2) + ':' + t[2];

  // ชื่อคน: บรรทัดที่ขึ้นต้นด้วยคำนำหน้า — คนแรก = ผู้โอน, คนที่สอง = ผู้รับ (อ่านได้เท่าที่ OCR เห็น ไม่ยืนยัน)
  var names = lines.filter(function (l) { return /^(นาย|นางสาว|นาง|น\.ส\.|ด\.ช\.|ด\.ญ\.|บริษัท|บจก\.?|หจก\.?|ร้าน|MR\.?|MRS\.?|MS\.?|MISS)\s*\S/i.test(l); })
    .map(function (l) { return l.slice(0, 60); });
  if (names[0]) out.sender = names[0];
  if (names[1]) out.receiver = names[1];
  for (var b = 0; b < SLIP_BANKS.length; b++) { if (text.indexOf(SLIP_BANKS[b][0]) >= 0) { out.bank = SLIP_BANKS[b][1]; break; } }
  var r = text.match(/(?:เลขที่รายการ|รหัสอ้างอิง|หมายเลขอ้างอิง|Ref\.?\s?No\.?|Transaction ID)\s*:?\s*([A-Za-z0-9]{6,40})/i);
  if (r) out.ref = r[1];

  out.isSlip = looksSlip && uniq.length > 0;
  return out;
}
function slipIso_(dd, mm, yy) {
  var y = Number(yy);
  if (String(yy).length === 2) y = y >= 50 ? 2500 + y : 2000 + y; // 69 → 2569 (พ.ศ.), 26 → 2026 (ค.ศ.)
  if (y > 2400) y -= 543;
  if (!(mm >= 1 && mm <= 12) || !(dd >= 1 && dd <= 31) || y < 2000 || y > 2100) return null;
  var dt = new Date(Date.UTC(y, mm - 1, dd));
  if (dt.getUTCMonth() !== mm - 1) return null; // 31 พ.ย. ไม่มีจริง
  return y + '-' + ('0' + mm).slice(-2) + '-' + ('0' + dd).slice(-2);
}

// ============ ติดตั้ง ============
/** รันครั้งเดียว — ตั้ง trigger ประมวลผลคิวทุก 1 นาที (รันซ้ำได้ ไม่สร้างซ้ำ) */
function installKarmtoLineBot() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'processKarmtoLineQueue') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('processKarmtoLineQueue').timeBased().everyMinutes(1).create();
  Logger.log('ติดตั้งแล้ว: ประมวลผลรูป/ข้อความจาก LINE ทุก 1 นาที');
}

