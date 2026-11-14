/**
 * Karmto — บอท LINE กลุ่มแบบเงียบ (โปรเจกต์ Apps Script แยก ไม่ใช่โปรเจกต์เดียวกับ Code.gs)
 *
 * ทำอะไร:
 *  - รูปสลิปในกลุ่ม → อ่านยอด/วันที่/เวลา/ผู้โอน (OCR ฟรีของ Google Drive) → เก็บลงคีย์ lineInbox:YYYY-MM-DD
 *    ให้แอปโชว์ในการ์ด "จับคู่ยอดโอน" (แท็บบิล) — AY เลือกบิลและกดยืนยันเองทุกครั้ง บอทไม่ติ๊กจ่าย/ไม่บันทึกเงิน
 *  - ข้อความตัวอักษรในกลุ่ม → เก็บลง lineInbox (type 'text') + ถ้าตั้ง LINE_NOTIFY_USER_ID จะส่งแจ้ง AY ทางแชทส่วนตัว
 *  - รูปที่ไม่ใช่สลิป (ออเดอร์/บิล) → ข้าม ไม่เก็บ
 *  - ส่งต่อ (Forward) รูปสลิปเข้าแชทส่วนตัวของบัญชีบอท → อ่านแบบเดียวกัน (ใช้เมื่อเอาบอทเข้ากลุ่มไม่ได้
 *    เช่น กลุ่มมีบัญชีทางการตัวอื่นอยู่แล้ว) — รับเฉพาะคนใน LINE_DIRECT_USER_IDS (User ID คั่นด้วย ,)
 *    วิธีหา ID: ให้คนในทีมส่งรูป 1 รูปเข้าแชทบอท → รัน showKarmtoLineGroups → คัดลอก ID ตามชื่อไปใส่
 *  - ไม่ตอบ/ไม่ส่งอะไรในกลุ่มเด็ดขาด (ไม่มีการเรียก reply และไม่ push เข้ากลุ่ม)
 *
 * ขั้นตอนติดตั้งสำหรับ AY (ทำครั้งเดียว ~30 นาที, ใช้คอม/แท็บเล็ตผ่านเว็บได้)
 *  ก. สร้าง LINE Official Account (ใช้อีเมลสมัครได้ ไม่ต้องใช้แอป LINE)
 *   1) entry.line.biz/start/th → สร้างบัญชี LINE Official Account ฟรี → เลือก "สมัครด้วยอีเมล" → ยืนยันอีเมล → กรอกฟอร์ม
 *   2) manager.line.biz → เลือกบัญชี → ตั้งค่า (มุมขวาบน)
 *      - Messaging API → เปิดใช้ Messaging API → สร้าง Provider ใหม่ (ชื่อ เช่น Karmto; เปลี่ยนทีหลังไม่ได้) → ตกลง
 *      - การตั้งค่าการตอบกลับ: ปิด "ข้อความตอบกลับอัตโนมัติ" + "ข้อความทักทาย", เปิด "Webhook"
 *      - การตั้งค่าบัญชี: เปิด "อนุญาตให้บัญชีเข้าร่วมแชทกลุ่มและแชทที่มีผู้ใช้หลายคน"
 *   3) developers.line.biz/console → เข้าด้วยบัญชีเดียวกับข้อ 1 → เลือก Provider → channel ของบัญชีนี้ → แท็บ Messaging API
 *      - "Allow bot to join group chats" = Enabled (ถ้ามีปุ่ม Edit ให้กดเปิด)
 *      - ล่างสุด Channel access token (long-lived) → Issue → คัดลอกเก็บไว้ (ห้ามส่งให้ใคร)
 *  ข. ตั้งบอทใน Google Apps Script (บัญชี Google เดียวกับที่ดูแลชีต Karmto)
 *   4) script.google.com → New project → ตั้งชื่อ "Karmto LINE Bot" → ลบโค้ดเปล่าทิ้ง → วางไฟล์นี้ทั้งไฟล์ → Save
 *   5) เมนูซ้าย Services (+) → เลือก "Drive API" → Add (ใช้ OCR อ่านสลิปฟรี)
 *   6) Project Settings (รูปเฟือง) → Script Properties → Add property:
 *        LINE_CHANNEL_ACCESS_TOKEN = token จากข้อ 3
 *        KARMTO_API_URL            = ลิงก์ /exec ของเว็บแอป Karmto ตัวเดิม (ค่าเดียวกับ SHEET_API_URL ใน index.html)
 *        KARMTO_KEY                = รหัสเข้าใช้ระบบ (ถ้าตั้งไว้ตาม AuthGuard.gs — ไม่ได้ตั้งก็ไม่ต้องใส่)
 *      (LINE_WEBHOOK_TOKEN ไม่ต้องตั้งเอง — ข้อ 8 สร้างให้)
 *   7) Deploy → New deployment → รูปเฟือง เลือก Web app → Execute as: Me, Who has access: Anyone → Deploy
 *      → Authorize access → เลือกบัญชี → Advanced → Go to Karmto LINE Bot (unsafe) → Allow
 *   8) ด้านบนเลือกฟังก์ชัน showKarmtoWebhookUrl → Run → ดู Execution log จะได้ลิงก์ webhook (ต้องลงท้าย /exec?t=…) คัดลอกไว้
 *      ห้ามแคปจอ/ส่งลิงก์นี้ให้ใคร — ถ้าเผลอส่ง: ลบ LINE_WEBHOOK_TOKEN แล้วรันข้อ 8 ใหม่ + วางลิงก์ใหม่ในข้อ 10
 *   9) เลือกฟังก์ชัน installKarmtoLineBot → Run ครั้งเดียว (ตั้งตัวประมวลผลทุก 1 นาที)
 *  ค. ต่อ LINE กับบอท
 *  10) developers.line.biz → แท็บ Messaging API → Webhook URL → Edit → วางลิงก์จากข้อ 8 → Update → เปิด Use webhook
 *      (ปุ่ม Verify อาจขึ้น error เพราะ Apps Script ตอบกลับแบบ redirect — ไม่เป็นไร ข้อความจริงยังเข้า)
 *  11) คนที่อยู่ในกลุ่มสาขา (ใครก็ได้) เพิ่มเพื่อนบัญชี OA นี้ (สแกน QR ใน manager.line.biz) → เข้ากลุ่ม → เชิญ → เลือกบัญชี OA
 *      (1 กลุ่มใส่ OA ได้ 1 บัญชี ถ้าเชิญไม่ได้ ให้เปิด "แชท" ในการตั้งค่าการตอบกลับเพิ่ม โดยยังเปิด Webhook ไว้)
 *  12) ส่งรูปอะไรก็ได้ 1 รูปในกลุ่ม → รอ 1 นาที → รัน showKarmtoLineGroups → ดู Group ID (ตัวท้ายสุด) ใน Execution log
 *      → Script Properties เพิ่ม LINE_GROUP_ID = Group ID นั้น (หลังตั้งแล้วบอทรับเฉพาะกลุ่มนี้กลุ่มเดียว)
 *  13) ทดสอบ: ส่งรูปสลิปจริง 1 ใบ → รอ 1–2 นาที → เปิดแอป Karmto แท็บบิล → การ์ด "จับคู่ยอดโอน" ต้องมีชิป "สลิปจาก LINE"
 *  ไม่บังคับ: LINE_NOTIFY_USER_ID = User ID ของ AY (developers.line.biz → Basic settings → Your user ID)
 *     ตั้งแล้วบอทจะส่งแจ้งทางแชทส่วนตัวเมื่อมีคนพิมพ์ข้อความในกลุ่ม (ใช้โควตา push ของแพ็กเกจ LINE OA — ไม่ตั้ง = ไม่ส่ง)
 *  แก้โค้ดภายหลัง: Deploy → Manage deployments → แก้ deployment เดิม → Version: New version (ลิงก์ไม่เปลี่ยน)
 *
 * ทางรับรูปจากภายนอก (ใช้เมื่อบอทเราเข้ากลุ่มไม่ได้เพราะกลุ่มมีบัญชีทางการของคนอื่นอยู่แล้ว) — "intake"
 *  - ใครส่ง: (ก) เซิร์ฟเวอร์ของบอทที่อยู่ในกลุ่ม ส่งสำเนารูปมาให้ (ดู docs/line-relay-for-it.md)
 *            (ข) โปรแกรมเฝ้าโฟลเดอร์บนคอมของ AY (tools/line-watcher/)
 *  - วิธีเปิดใช้: ทำข้อ ข.4–9 ให้เสร็จ (ไม่ต้องมี LINE OA ก็ได้ — ข้าม LINE_CHANNEL_ACCESS_TOKEN ได้ถ้าใช้ทางนี้อย่างเดียว)
 *    → รัน showKarmtoIntakeUrl → ได้ลิงก์ลงท้าย /exec?a=intake&t=… (รหัสลับคนละตัวกับ webhook — ยกเลิกแยกกันได้โดยลบ KARMTO_INTAKE_TOKEN)
 *  - รูปแบบคำขอ: POST JSON { image: "<base64 ของไฟล์ JPEG/PNG>", sender: "ชื่อผู้ส่งในกลุ่ม (ไม่บังคับ)", sentAt: "เวลาส่ง (ไม่บังคับ)" }
 *    ตอบ { ok:true, id } / { ok:true, dup:true } (รูปเดิมเคยส่งแล้ว) / { ok:false, error }
 *  - รูปถูกพักในโฟลเดอร์ Drive "Karmto LINE Intake" แล้วตัวประมวลผลทุก 1 นาทีอ่านต่อ → ลบไฟล์ถาวรเมื่อเสร็จ
 *  - รูปออเดอร์ (มีคำว่า สาขา/ธง + ตัวเลข และไม่มีคำเรื่องเงิน) → เก็บข้อความที่อ่านได้ลง lineOrders:YYYY-MM-DD เป็น "ร่าง"
 *    ให้ AY แตะเติมฟอร์มในหน้าออเดอร์แล้วกดบันทึกเอง — บอทไม่บันทึกออเดอร์ ไม่ติ๊กจ่าย ไม่แตะต้นทุน
 *
 * ความปลอดภัย: Apps Script อ่าน header X-Line-Signature ไม่ได้ (ข้อจำกัดของ Google) จึงกันด้วย
 *  (ก) รหัสลับ ?t= ในลิงก์ webhook (ข) รับเฉพาะ LINE_GROUP_ID และคนใน LINE_DIRECT_USER_IDS (ค) รูปดึงจากเซิร์ฟเวอร์ LINE ด้วย token ของเราเองเท่านั้น
 *  ใครปลอมคำขอมาก็ได้แค่ messageId ที่ LINE ไม่รู้จัก → ดึงรูปไม่ได้ → ไม่มีอะไรถูกบันทึก
 */

var LINE_QUEUE_PROP = 'LINE_QUEUE';
var LINE_QUEUE_MAX = 300;
var LINE_QUEUE_MAX_BYTES = 8500; // ค่าใน Script Properties ได้ไม่เกิน ~9KB ต่อค่า
var LINE_MAX_TRIES = 3;
var LINE_RAW_TEXT_MAX = 300;
var LINE_TZ = 'Asia/Bangkok';
var LINE_INTAKE_FOLDER = 'Karmto LINE Intake';
var LINE_INTAKE_MAX_BYTES = 5 * 1024 * 1024;
var LINE_INTAKE_MAX_PER_DAY = 1500; // กันคนยิงถล่ม — เกินนี้ต่อวันไม่รับ
var LINE_ORDER_TEXT_MAX = 900;
var LINE_INBOX_MAX_ITEMS = 80;  // สลิป+ข้อความ ต่อวัน
var LINE_ORDERS_MAX_ITEMS = 45; // ร่างออเดอร์ ต่อวัน

// ============ webhook: รับเร็ว ใส่คิว ตอบ 200 — ไม่ประมวลผลหนักตรงนี้ ============
function doPost(e) {
  var props = PropertiesService.getScriptProperties();
  if (e && e.parameter && e.parameter.a === 'intake') return lineIntake_(e, props);
  var want = props.getProperty('LINE_WEBHOOK_TOKEN');
  var got = (e && e.parameter && e.parameter.t) || '';
  if (!want || want.length < 24 || got !== want) return lineOk_(); // ไม่บอกผู้เรียกว่าผิดอะไร; รหัสสั้นเกิน = ไม่รับเลย
  var body;
  try { body = JSON.parse((e.postData && e.postData.contents) || '{}'); } catch (err) { return lineOk_(); }
  var allowGroup = props.getProperty('LINE_GROUP_ID') || '';
  var items = [];
  var allowUsers = (props.getProperty('LINE_DIRECT_USER_IDS') || '').split(',').map(function (x) { return x.trim(); }).filter(String);
  (body.events || []).forEach(function (ev) {
    if (!ev || ev.type !== 'message' || !ev.message || !ev.source) return;
    // แชทส่วนตัวกับบัญชีบอท: รับเฉพาะรูป (ส่งต่อสลิปจากกลุ่มอื่นมาให้อ่าน) — ข้อความตัวอักษรไม่เก็บ
    if (ev.source.type === 'user') {
      var duid = String(ev.source.userId || '');
      if (!/^U[0-9a-f]{32}$/.test(duid)) return;
      // รับเฉพาะคนใน LINE_DIRECT_USER_IDS — ยังไม่ตั้ง/ไม่อยู่ในรายชื่อ = จำ ID ไว้ให้ AY เลือก ไม่เก็บสลิป (กันคนนอกส่งสลิปปลอม)
      if (allowUsers.indexOf(duid) < 0) { lineRememberUser_(props, duid); return; }
      var dmid = String(ev.message.id || '');
      if (ev.message.type !== 'image' || !/^\d{1,30}$/.test(dmid)) return;
      items.push({ mid: dmid, ts: Date.now(), uid: duid, gid: '', direct: true, kind: 'image', tries: 0 });
      return;
    }
    if (ev.source.type !== 'group') return;
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
function lineJson_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// ============ ทางรับรูปจากภายนอก (intake): ตรวจรหัส/ขนาด/ชนิด → พักไฟล์ใน Drive → ตัวประมวลผลอ่านต่อ ============
function lineIntake_(e, props) {
  var want = props.getProperty('KARMTO_INTAKE_TOKEN');
  var got = (e.parameter && e.parameter.t) || '';
  if (!want || want.length < 24 || got !== want) return lineOk_(); // รหัสผิด: ตอบเหมือนปกติ ไม่บอกอะไร ไม่เก็บอะไร
  var body;
  try { body = JSON.parse((e.postData && e.postData.contents) || '{}'); } catch (err) { return lineJson_({ ok: false, error: 'bad_json' }); }
  var b64 = String((body && body.image) || '').replace(/^data:[^,]{0,80},/, '').replace(/\s+/g, '');
  if (!b64) return lineJson_({ ok: false, error: 'no_image' });
  if (b64.length > LINE_INTAKE_MAX_BYTES * 1.4) return lineJson_({ ok: false, error: 'too_big' });
  var bytes;
  try { bytes = Utilities.base64Decode(b64); } catch (err2) { return lineJson_({ ok: false, error: 'bad_image' }); }
  if (!bytes || bytes.length < 200 || bytes.length > LINE_INTAKE_MAX_BYTES) return lineJson_({ ok: false, error: 'too_big' });
  var mime = lineImageMime_(bytes);
  if (!mime) return lineJson_({ ok: false, error: 'not_image' }); // รับเฉพาะ JPEG/PNG (ดูจากหัวไฟล์จริง ไม่เชื่อชนิดที่ผู้ส่งบอก)
  var id = 'H' + lineHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, bytes)).slice(0, 24);
  var cache = CacheService.getScriptCache();
  if (cache.get('done:' + id)) return lineJson_({ ok: true, dup: true });
  var capKey = 'intake:' + Utilities.formatDate(new Date(), LINE_TZ, 'yyyy-MM-dd');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var n = Number(cache.get(capKey) || 0); // อ่าน+เพิ่มใน lock เดียวกัน (คำขอพร้อมกันไม่ทะลุเพดาน)
    if (n >= LINE_INTAKE_MAX_PER_DAY) return lineJson_({ ok: false, error: 'daily_limit' });
    var folder = lineIntakeFolder_(true);
    var same = folder.getFilesByName(id);
    while (same.hasNext()) { if (!same.next().isTrashed()) return lineJson_({ ok: true, dup: true }); }
    var file = folder.createFile(Utilities.newBlob(bytes, mime, id));
    file.setDescription(JSON.stringify({ sender: lineCleanLabel_(body.sender, 60), sentAt: lineCleanLabel_(body.sentAt, 40), ts: Date.now(), tries: 0 }));
    cache.put(capKey, String(n + 1), 21600);
  } finally { lock.releaseLock(); }
  return lineJson_({ ok: true, id: id });
}
function lineImageMime_(bytes) {
  var b = function (i) { return bytes[i] & 255; };
  if (b(0) === 0xFF && b(1) === 0xD8 && b(2) === 0xFF) return 'image/jpeg';
  if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4E && b(3) === 0x47) return 'image/png';
  return null;
}
function lineHex_(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; i++) s += ('0' + (bytes[i] & 255).toString(16)).slice(-2);
  return s;
}
function lineCleanLabel_(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
// โฟลเดอร์พักรูป: จำด้วย ID ที่เราสร้างเองเท่านั้น (ไม่หาด้วยชื่อ — คนอื่นแชร์โฟลเดอร์ชื่อเดียวกันมาให้ก็ไม่ถูกอ่าน)
function lineIntakeFolder_(create) {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('KARMTO_INTAKE_FOLDER_ID');
  if (id) {
    try { var f = DriveApp.getFolderById(id); if (f && !f.isTrashed()) return f; } catch (e) {}
  }
  if (!create) return null;
  var nf = DriveApp.createFolder(LINE_INTAKE_FOLDER);
  props.setProperty('KARMTO_INTAKE_FOLDER_ID', nf.getId());
  return nf;
}
function lineDeleteFile_(file) { // ลบถาวร (ไม่ค้างถังขยะ 30 วัน)
  try { Drive.Files.remove(file.getId()); } catch (e) { try { file.setTrashed(true); } catch (e2) {} }
}
/** รันหลัง Deploy: สร้างรหัสลับทางรับรูป (ถ้ายังไม่มี) แล้วพิมพ์ลิงก์ที่ให้ไอทีของบอทในกลุ่ม / โปรแกรมเฝ้าโฟลเดอร์ใช้ส่งรูปมา */
function showKarmtoIntakeUrl() {
  var props = PropertiesService.getScriptProperties();
  var tok = props.getProperty('KARMTO_INTAKE_TOKEN');
  if (!tok || tok.length < 24) {
    tok = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    props.setProperty('KARMTO_INTAKE_TOKEN', tok);
  }
  var url = ScriptApp.getService().getUrl();
  var tail = '?a=intake&t=' + tok;
  if (!url || !/\/exec$/.test(url)) {
    Logger.log('ไปที่ Deploy → Manage deployments คัดลอก Web app URL (ลงท้าย /exec) แล้วต่อท้ายด้วย:\n' + tail);
    return tail;
  }
  Logger.log('ลิงก์รับรูป (ให้เฉพาะคนที่ต้องส่งรูปมา ห้ามโพสต์ที่อื่น — ถ้าหลุด: ลบ KARMTO_INTAKE_TOKEN แล้วรันฟังก์ชันนี้ใหม่):\n' + url + tail);
  return url + tail;
}
// ตัวประมวลผลรูปที่พักไว้ — เรียกจาก processKarmtoLineQueue (ใช้ lock/งบเวลาเดียวกัน)
function lineProcessIntake_(cache, started) {
  var folder = lineIntakeFolder_(false);
  if (!folder) return;
  var files = folder.getFiles();
  while (files.hasNext() && Date.now() - started < 4 * 60 * 1000) {
    var f = files.next();
    if (f.isTrashed()) continue;
    var id = String(f.getName());
    if (!/^H[0-9a-f]{24}$/.test(id)) { lineDeleteFile_(f); continue; } // ไฟล์แปลกปลอมในโฟลเดอร์ → ทิ้ง
    var meta = {};
    try { meta = JSON.parse(f.getDescription() || '{}') || {}; } catch (e) { meta = {}; }
    try {
      if (!cache.get('done:' + id)) {
        if (f.getSize() > LINE_INTAKE_MAX_BYTES) { lineDeleteFile_(f); continue; } // ตรวจซ้ำ: ไฟล์ที่ไม่ได้เข้าทางด่านรับ
        var blob = f.getBlob();
        if (!lineImageMime_(blob.getBytes())) { lineDeleteFile_(f); continue; }
        lineHandleBlob_(blob, { id: id, ts: Number(meta.ts) || Date.now(), who: lineCleanLabel_(meta.sender, 60), via: 'intake', sentAt: lineCleanLabel_(meta.sentAt, 40) });
        cache.put('done:' + id, '1', 21600);
      }
      lineDeleteFile_(f);
    } catch (err) {
      Logger.log('Karmto LINE intake: ' + id + ' ' + (err && err.message));
      meta.tries = (Number(meta.tries) || 0) + 1;
      if (meta.tries >= LINE_MAX_TRIES) lineDeleteFile_(f); else f.setDescription(JSON.stringify(meta));
      break; // พังแล้วพักไว้รอบหน้า (เน็ต/โควตา)
    }
  }
}

function lineRememberGroup_(props, gid) {
  var seen = (props.getProperty('LINE_SEEN_GROUP_IDS') || '').split(',').filter(String);
  if (seen.indexOf(gid) < 0) { seen.push(gid); props.setProperty('LINE_SEEN_GROUP_IDS', seen.slice(-10).join(',')); }
}
/** รันหลัง Deploy: สร้างรหัสลับ webhook (ถ้ายังไม่มี) แล้วพิมพ์ลิงก์ webhook ที่ต้องวางใน LINE Developers */
function showKarmtoWebhookUrl() {
  var props = PropertiesService.getScriptProperties();
  var tok = props.getProperty('LINE_WEBHOOK_TOKEN');
  if (!tok || tok.length < 24) {
    tok = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    props.setProperty('LINE_WEBHOOK_TOKEN', tok);
  }
  var url = ScriptApp.getService().getUrl();
  if (!url) { Logger.log('ยังไม่ได้ Deploy เป็น Web app — ทำขั้นตอนที่ 7 ก่อน'); return ''; }
  if (!/\/exec$/.test(url)) { // บางครั้งได้ลิงก์ทดสอบ /dev ซึ่ง LINE เรียกไม่ได้
    Logger.log('ได้ลิงก์ที่ไม่ใช่ /exec — ไปที่ Deploy → Manage deployments คัดลอก Web app URL (ลงท้าย /exec) แล้วต่อท้ายด้วย:\n?t=' + tok);
    return '?t=' + tok;
  }
  var full = url + '?t=' + tok;
  Logger.log('ลิงก์ Webhook (วางใน LINE Developers → Messaging API → Webhook URL):\n' + full);
  return full;
}
function lineRememberUser_(props, uid) {
  var seen = (props.getProperty('LINE_SEEN_USER_IDS') || '').split(',').filter(String);
  if (seen.indexOf(uid) < 0) { seen.push(uid); props.setProperty('LINE_SEEN_USER_IDS', seen.slice(-10).join(',')); }
}
/** รันเองหลังเชิญบอทเข้ากลุ่ม / หลังมีคนส่งรูปเข้าแชทบอท → ดู Group ID และ User ID (พร้อมชื่อ) ใน Execution log */
function showKarmtoLineGroups() {
  var props = PropertiesService.getScriptProperties();
  Logger.log('Group ID ที่บอทเห็น: ' + (props.getProperty('LINE_SEEN_GROUP_IDS') || '(ยังไม่มี — ส่งรูปในกลุ่มก่อน 1 รูป)'));
  var users = (props.getProperty('LINE_SEEN_USER_IDS') || '').split(',').filter(String);
  if (!users.length) { Logger.log('คนที่ส่งรูปเข้าแชทบอท (ยังไม่อยู่ในรายชื่อ): ยังไม่มี'); return; }
  var token = props.getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  Logger.log('คนที่ส่งรูปเข้าแชทบอท (ยังไม่อยู่ในรายชื่อ) — คัดลอก ID คนในทีมไปใส่ LINE_DIRECT_USER_IDS คั่นด้วย , :\n' +
    users.map(function (u) { return (token ? (lineProfileName_(token, u) || '(ไม่ทราบชื่อ)') : '') + ' ' + u; }).join('\n'));
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
    try { lineProcessIntake_(cache, started); } catch (err2) { Logger.log('Karmto LINE intake: ' + (err2 && err2.message)); } // ทางรับรูปพังต้องไม่กระทบคิว LINE
  } finally { lock.releaseLock(); }
}

function lineHandleItem_(it, props) {
  var token = props.getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token) throw new Error('ยังไม่ได้ตั้ง LINE_CHANNEL_ACCESS_TOKEN');
  var day = Utilities.formatDate(new Date(it.ts), LINE_TZ, 'yyyy-MM-dd');
  var at = Utilities.formatDate(new Date(it.ts), LINE_TZ, "yyyy-MM-dd'T'HH:mm:ss");
  var who = it.direct ? lineProfileName_(token, it.uid) : lineMemberName_(token, it.gid, it.uid);
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
  lineHandleBlob_(blob, { id: 'L' + it.mid, ts: it.ts, who: who, via: it.direct ? 'direct' : 'group' });
}

// อ่านรูป 1 ใบ → สลิป: ลง lineInbox | ออเดอร์: ลง lineOrders (ร่าง) | อย่างอื่น (บิล/รูปทั่วไป): ข้าม ไม่เก็บ
// ทุกทางเข้าใช้ตัวนี้ตัวเดียว (กลุ่ม / แชทบอท / intake) — แค่ "วางไว้ให้ AY ดู" ไม่ติ๊กจ่าย ไม่บันทึกออเดอร์
function lineHandleBlob_(blob, m) {
  var day = Utilities.formatDate(new Date(m.ts), LINE_TZ, 'yyyy-MM-dd');
  var at = Utilities.formatDate(new Date(m.ts), LINE_TZ, "yyyy-MM-dd'T'HH:mm:ss");
  var text = lineOcr_(blob);
  var slip = parseSlipText_(text);
  if (slip.isSlip) {
    var item = {
      id: m.id, type: 'slip', at: at, postedBy: m.who, via: m.via,
      amount: slip.amount, amountCands: slip.amountCands, slipDate: slip.date, slipTime: slip.time,
      sender: slip.sender, receiver: slip.receiver, bank: slip.bank, ref: slip.ref,
      text: lineMaskDigits_(String(text || '').replace(/\s+/g, ' ')).slice(0, LINE_RAW_TEXT_MAX), // ปิดเลขบัญชี/เลขยาว
    };
    if (slip.senderAcct) item.senderAcct = slip.senderAcct; // เลขบัญชีแบบที่ธนาคารปิดบางหลักไว้แล้วบนสลิป (ไม่ใช่เลขเต็ม)
    if (m.sentAt) item.sentAt = m.sentAt;
    karmtoKeyPush_('lineInbox:' + day, item);
    return 'slip';
  }
  var ord = orderDraftText_(text);
  if (ord) {
    var o = { id: m.id, type: 'order', at: at, postedBy: m.who, via: m.via, text: ord };
    if (m.sentAt) o.sentAt = m.sentAt;
    karmtoKeyPush_('lineOrders:' + day, o);
    return 'order';
  }
  return 'skip';
}
function lineMaskDigits_(s) {
  return String(s).replace(/\d{6,}/g, function (d) { return 'x'.repeat(d.length - 4) + d.slice(-4); });
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
function lineProfileName_(token, uid) {
  if (!uid) return null;
  try {
    var r = UrlFetchApp.fetch('https://api.line.me/v2/bot/profile/' + encodeURIComponent(uid), {
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
function karmtoInboxPush_(day, item) { karmtoKeyPush_('lineInbox:' + day, item); }
function karmtoKeyPush_(storeKey, item) {
  if (!/^(lineInbox|lineOrders):\d{4}-\d{2}-\d{2}$/.test(storeKey)) throw new Error('คีย์ไม่ถูกต้อง'); // บอทเขียนได้แค่ 2 คีย์นี้ ไม่แตะคีย์เงิน/ออเดอร์จริง
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('KARMTO_API_URL');
  if (!url) throw new Error('ยังไม่ได้ตั้ง KARMTO_API_URL');
  // มี id นี้อยู่แล้ว (รอบก่อนเขียนสำเร็จแต่เราไม่รู้) → ข้าม ไม่ทับป้าย matched/dismissed ที่ AY ติดไว้
  var st = karmtoKeyState_(url, props.getProperty('KARMTO_KEY'), storeKey, item.id);
  if (st.has) return;
  // เพดานรายการต่อคีย์ต่อวัน (ช่องเก็บรับได้ราว 5 หมื่นตัวอักษร) — เต็มแล้วไม่เขียนเพิ่ม กันถูกถล่มจนของจริงบันทึกไม่ได้
  if (st.n >= (/^lineOrders:/.test(storeKey) ? LINE_ORDERS_MAX_ITEMS : LINE_INBOX_MAX_ITEMS)) { Logger.log('Karmto LINE: ' + storeKey + ' เต็ม ไม่เก็บ ' + item.id); return; }
  // ลบ id เดิม (ถ้ามี) แล้ว push ในคำขอเดียว — ลองใหม่หลังเน็ตหลุดกี่ครั้งก็ไม่เกิดรายการซ้ำ
  var body = { action: 'patchOps', key: storeKey, ops: [{ arrayPath: [], remove: { matchField: 'id', matchValue: item.id } }, { arrayPath: [], push: item }], rootIsArray: true };
  var key = props.getProperty('KARMTO_KEY');
  if (key) body.k = key;
  var res = UrlFetchApp.fetch(url, { method: 'post', contentType: 'text/plain;charset=utf-8', payload: JSON.stringify(body), muteHttpExceptions: true });
  var code = res.getResponseCode();
  if (code < 200 || code >= 300) throw new Error('บันทึก ' + storeKey + ' ไม่ได้ HTTP ' + code);
  var data = JSON.parse(res.getContentText());
  if (data && data.error) throw new Error('บันทึก ' + storeKey + ' ไม่ได้: ' + data.error);
}

// อ่านอย่างเดียว: คีย์วันนี้มีรายการ id นี้หรือยัง (อ่านไม่ได้/ไม่มีคีย์ = ถือว่ายังไม่มี)
function karmtoInboxHas_(url, key, day, id) { return karmtoKeyHas_(url, key, 'lineInbox:' + day, id); }
function karmtoKeyHas_(url, key, storeKey, id) { return karmtoKeyState_(url, key, storeKey, id).has; }
function karmtoKeyState_(url, key, storeKey, id) {
  try {
    var q = '?action=get&key=' + encodeURIComponent(storeKey) + (key ? '&k=' + encodeURIComponent(key) : '');
    var r = UrlFetchApp.fetch(url + q, { method: 'get', muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) return { has: false, n: 0 };
    var data = JSON.parse(r.getContentText());
    var arr = data && typeof data.value === 'string' ? JSON.parse(data.value) : null;
    if (!Array.isArray(arr)) return { has: false, n: 0 };
    return { has: arr.some(function (x) { return x && x.id === id; }), n: arr.length };
  } catch (e) { return { has: false, n: 0 }; }
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
  var out = { isSlip: false, amount: null, amountCands: [], date: null, time: null, sender: null, receiver: null, bank: null, ref: null, senderAcct: null, receiverAcct: null };
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

  // เลขบัญชีแบบปิดบางหลัก (เช่น xxx-x-x1234-x) — ต้องมีทั้งตัวปิด (x/*) และเลข ≥ 3 ตัว; ตัวแรก = ผู้โอน ตัวที่สอง = ผู้รับ
  // ใช้ช่วยจำว่าผู้โอนคนนี้คือสาขาไหน (AY ยืนยันเองในแอป) — ไม่ใช้ตัดสินเรื่องเงิน
  var accts = [];
  lines.forEach(function (l) {
    var re = /(?:^|[^A-Za-z0-9*-])((?:[xX*\d]{1,7}-){1,5}[xX*\d]{1,7}|[xX*]{2,}\d{3,6}[xX*]{0,3})(?![A-Za-z0-9*-])/g, am;
    while ((am = re.exec(l))) {
      var tok = am[1];
      if (/[xX*]/.test(tok) && (tok.match(/\d/g) || []).length >= 3) accts.push(tok.replace(/[X*]/g, 'x').slice(0, 24));
    }
  });
  if (accts[0]) out.senderAcct = accts[0];
  if (accts[1]) out.receiverAcct = accts[1];

  out.isSlip = looksSlip && uniq.length > 0;
  return out;
}

// ============ ตัวคัดรูปออเดอร์ (ฟังก์ชันล้วน) ============
// ไม่เดา: ต้องมีคำว่า สาขา+เลข หรือ ธง, มีบรรทัดอื่นที่มีตัวเลข และต้องไม่มีคำเรื่องเงิน (รูปบิลที่ AY ส่งเองจะไม่ถูกเก็บ)
// คืนข้อความที่ตัดสั้นแล้ว (เก็บขึ้นบรรทัดใหม่ไว้ให้ตัวอ่านออเดอร์ในแอปใช้) หรือ null = ไม่ใช่ออเดอร์
function orderDraftText_(raw) {
  var lines = String(raw || '').replace(/\r/g, '').split('\n').map(function (l) { return l.replace(/[ \t\u00a0]+/g, ' ').trim(); }).filter(String);
  var joined = lines.join('\n');
  var br = -1;
  for (var i = 0; i < lines.length; i++) { if (/สาขา\s*\d+/.test(lines[i]) || /ธง/.test(lines[i])) { br = i; break; } }
  if (br < 0) return null;
  if (/(บาท|฿|THB|ราคา|ยอดรวม|รวมทั้งสิ้น|ยอดชำระ|ค้างชำระ|โอนเงิน|บัญชี)/i.test(joined)) return null;
  var hasQty = lines.some(function (l, k) { return k !== br && /\d/.test(l); });
  if (!hasQty) return null;
  return lineMaskDigits_(lines.slice(0, 30).map(function (l) { return l.slice(0, 60); }).join('\n')).slice(0, LINE_ORDER_TEXT_MAX);
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

