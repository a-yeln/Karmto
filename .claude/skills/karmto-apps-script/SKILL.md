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
- Apps Script อ่าน header ไม่ได้ → ตรวจ `X-Line-Signature` ไม่ได้ ใช้แทน: รหัส `?t=` (LINE_WEBHOOK_TOKEN) + `LINE_GROUP_ID` + ดึงรูปจาก LINE ด้วย token ตัวเอง (messageId ปลอม = 404 ไม่บันทึก)
- `doPost` แค่ใส่คิว (Script Properties `LINE_QUEUE`) แล้วตอบทันที; งานหนัก (ดึงรูป/OCR/เขียน) อยู่ใน `processKarmtoLineQueue` (trigger ทุก 1 นาที)
- OCR = Drive advanced service (`Drive.Files.insert` v2 หรือ `create` v3 + ocrLanguage th) → ตัวอ่าน `parseSlipText_` ไม่เดา: หลายยอด → amount null
- เขียนผ่าน API ของแอป: `patchOps` key `lineInbox:YYYY-MM-DD`, `[{arrayPath:[], push:item}]`, rootIsArray true
- เทส: `tests/specs/line-bot-backend.spec.js` (vm + mock บริการ Apps Script)
- ห้าม reply/push ในกลุ่ม
- รูปสลิป → OCR ยอด/วันที่/ผู้โอน → `lineInbox:YYYY-MM-DD` (ไม่เช็ค QR)
- รูปออเดอร์ → ร่างไว้ให้หน้าออเดอร์ (AY กดยืนยันเอง)
- รูปบิล → ข้าม
- ข้อความตัวอักษร → push แจ้ง AY ส่วนตัวทันที + ลง Notifications
- ห้ามบันทึกเงิน/ตัดยอดจ่ายเอง
