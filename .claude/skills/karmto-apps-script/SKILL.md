---
name: karmto-apps-script
description: แพทเทิร์นเขียน Google Apps Script (backend/*.gs) ของ Karmto รวมกติกาบอท LINE แบบเงียบ — ใช้เมื่อแก้หรือสร้างไฟล์ .gs
---
# Apps Script Karmto

- `Code.gs` หลักไม่อยู่ใน repo — ทำเป็นไฟล์แยก อย่าสมมติโค้ดในนั้น
- หัวไฟล์ต้องมี "ขั้นตอนติดตั้งสำหรับ AY" ภาษาไทยทีละข้อ (ดู `backend/AuthGuard.gs` เป็นตัวอย่าง)
- secret ทั้งหมดอ่านจาก `PropertiesService.getScriptProperties()` — ไม่ตั้ง = ระบบทำงานเหมือนเดิม
- เขียน Sheets แบบ patch ทีละคีย์; คีย์ใหม่ใส่ใน `backend/BackupTrigger.gs`

## บอท LINE กลุ่ม (แผนข้อ 6) — เงียบ
- `doPost` ตรวจ `X-Line-Signature` (HMAC-SHA256 ด้วย channel secret) ก่อนทำอะไร
- ห้าม reply/push ในกลุ่ม
- รูปสลิป → OCR ยอด/วันที่/ผู้โอน → `lineInbox:YYYY-MM-DD` (ไม่เช็ค QR)
- รูปออเดอร์ → ร่างไว้ให้หน้าออเดอร์ (AY กดยืนยันเอง)
- รูปบิล → ข้าม
- ข้อความตัวอักษร → push แจ้ง AY ส่วนตัวทันที + ลง Notifications
- ห้ามบันทึกเงิน/ตัดยอดจ่ายเอง
