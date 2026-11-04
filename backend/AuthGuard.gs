/**
 * Karmto — ตรวจรหัสเข้าใช้ระบบ (วางไฟล์นี้ในโปรเจกต์ Apps Script เดียวกับ Code.gs)
 *
 * วิธีติดตั้ง (ทำตามลำดับ กันแอปใช้ไม่ได้ระหว่างเปลี่ยน):
 *  1) เปิดแอป Karmto ทุกเครื่อง → ตั้งค่า → 🔐 รหัสเข้าใช้ระบบ → ใส่รหัสเดียวกันทุกเครื่อง (ยังไม่มีผลอะไรจนกว่าจะทำข้อ 3)
 *  2) ใน Apps Script: Project Settings → Script Properties → Add property
 *       ชื่อ  KARMTO_KEY   ค่า = รหัสเดียวกับข้อ 1
 *  3) ใน Code.gs เพิ่มบรรทัดแรกสุดของ doGet และ doPost:
 *
 *       function doGet(e) {
 *         var denied = karmtoAuthDenied_(e); if (denied) return denied;
 *         ... โค้ดเดิม ...
 *       }
 *       function doPost(e) {
 *         var denied = karmtoAuthDenied_(e); if (denied) return denied;
 *         ... โค้ดเดิม ...
 *       }
 *
 *  4) Deploy → Manage deployments → แก้ deployment เดิม → Version: New version → Deploy
 *     (ใช้ deployment เดิม ลิงก์ /exec จะไม่เปลี่ยน แอปไม่ต้องแก้ลิงก์)
 *
 * ถ้ายังไม่ได้ตั้ง KARMTO_KEY ระบบเปิดใช้ได้เหมือนเดิม (ไม่ตรวจ) — ลบ property ทิ้งเมื่อไหร่ก็กลับเป็นแบบเดิมทันที
 * รหัสไม่ได้อยู่ในโค้ดเว็บ (ที่ใครก็เปิดดูได้) แต่ละเครื่องเก็บไว้ในเครื่องตัวเอง
 */
function karmtoAuthDenied_(e) {
  var want = PropertiesService.getScriptProperties().getProperty('KARMTO_KEY');
  if (!want) return null;
  var got = (e && e.parameter && e.parameter.k) || '';
  if (!got && e && e.postData && e.postData.contents) {
    try { got = JSON.parse(e.postData.contents).k || ''; } catch (err) { got = ''; }
  }
  if (got === want) return null;
  return ContentService.createTextOutput(JSON.stringify({ error: 'unauthorized' }))
    .setMimeType(ContentService.MimeType.JSON);
}
