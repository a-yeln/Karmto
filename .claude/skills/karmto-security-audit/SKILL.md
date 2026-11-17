---
name: karmto-security-audit
description: เช็คลิสต์และคำสั่งสแกนความปลอดภัยของ Karmto (XSS, secret รั่ว, สคริปต์ภายนอก, Apps Script/LINE webhook, โค้ดอันตราย) — ใช้ก่อน merge ทุก PR และตรวจทั้ง repo เป็นระยะ
---
# ตรวจความปลอดภัย Karmto

## จุดเสี่ยงที่รู้แล้ว (ณ 2026-11-07)
- `innerHTML` ~233 จุด แต่ `escapeHtml` (~L2227) ถูกใช้ ~112 จุด → ทุก string จากผู้ใช้/OCR/LINE ต้องผ่าน `escapeHtml`
  จุดที่ควรตรวจ: `lotLabel_` (customName), ชื่อสินค้า/สาขา/ผู้ขาย/หมวด, รายการบิลพิเศษ, ข้อความ OCR, `logActivity_` → `renderActivityFeed_`
- `ensureLib_` (~L2107) โหลด html2canvas / tesseract.js@5 (เวอร์ชันลอย) / jszip โดยไม่มี SRI
- API key อยู่ใน localStorage และส่งใน query string (GET) — ระวังไม่ให้ไปโผล่ใน log/ลิงก์ที่แชร์
- ไม่พบ `eval` / `new Function` / `setTimeout(string)` — ต้องคงไว้แบบนี้
- **`KARMTO_KEY` ยังไม่ได้ตั้ง** (ณ 2026-11-17) → ตอนนี้ใครมีลิงก์ `/exec` ก็อ่าน/เขียนข้อมูลได้ — ทางแก้จริงคือเจ้าของตั้งรหัสเอง
  (ขั้นตอนหัวไฟล์ `backend/AuthGuard.gs`, เช็คลิสต์ใน `.claude/agents/karmto-security-guard.md`) โค้ดในแอปช่วยไม่ได้
- **repo เป็นสาธารณะ** และลิงก์ Apps Script `/exec` อยู่ในโค้ด (`SHEET_API_URL` ใน `index.html`, `BACKUP_SHEET_API_URL` ใน `backend/BackupTrigger.gs`)
  → ใครก็อ่านโค้ดได้ ห้ามมี key/token/รหัสใดๆ ใน repo **และในประวัติ git** (ลบ commit ทีหลังไม่ช่วย ต้องเปลี่ยนรหัสใหม่)
- secret ทุกตัว (`KARMTO_KEY`, `LINE_WEBHOOK_TOKEN`, `KARMTO_INTAKE_TOKEN`, `LINE_CHANNEL_ACCESS_TOKEN` ฯลฯ) อยู่ใน **Script Properties เท่านั้น**
  ฝั่งแอปเก็บรหัสเข้าใช้ไว้ใน localStorage ของแต่ละเครื่อง — ห้ามฝังในโค้ด/เทส/เอกสาร/ข้อความ commit

## เช็คลิสต์ diff
1. HTML injection: ค่าใหม่ที่ใส่ใน `innerHTML`/`insertAdjacentHTML`/template ผ่าน `escapeHtml` ครบไหม
2. ไม่มี `eval`, `new Function`, `document.write`, `setTimeout/setInterval` แบบ string
3. สคริปต์ภายนอก: โดเมนที่รู้จัก + ล็อกเวอร์ชันชัด
4. Secret: `git diff` และไฟล์ใหม่ไม่มี token/key/รหัส (`grep -nEi 'token|secret|api[_-]?key|password|Bearer '`)
5. Apps Script: ทุก endpoint ตรวจ `KARMTO_KEY` (`karmtoAuthDenied_` ใน `backend/AuthGuard.gs`);
   webhook LINE: Apps Script อ่าน header ไม่ได้ (ดูหัวไฟล์ `backend/LineBot.gs`) จึงใช้รหัสลับ `?t=` (`LINE_WEBHOOK_TOKEN`) ยาวอย่างน้อย 24 ตัว
   (`want.length < 24` = ไม่รับเลย) + รับเฉพาะ `LINE_GROUP_ID`/`LINE_DIRECT_USER_IDS`; ทาง intake (`?a=intake`, `lineIntake_`)
   ใช้ `KARMTO_INTAKE_TOKEN` แยก (ยาว ≥24 เหมือนกัน) — ห้ามลดด่านเหล่านี้ (ห้ามลดความยาว ห้ามรับทุกกลุ่ม/ทุกคน ห้ามใช้รหัสเดียวกันสองทาง)
6. ข้อมูลส่วนตัว (ชื่อผู้โอน เลขบัญชี) ไม่ลง log/console
7. ไฟล์อัปโหลด: ตรวจชนิดและขนาด
8. ห้ามลด/ปิดการตรวจสิทธิ์เพื่อให้เทสผ่าน

## สแกนทั้ง repo ("ตรวจไวรัส" ระดับโค้ด)
```bash
git ls-files | xargs file | grep -viE 'text|json|empty|image|svg'          # ไฟล์ไบนารีแปลก
grep -rnEi 'eval\(|new Function|atob\(|fromCharCode|document\.write' --include='*.html' --include='*.js' --include='*.gs' .
grep -rnoE 'https?://[a-zA-Z0-9.-]+' index.html backend | sort -u           # โดเมนทั้งหมดที่โค้ดติดต่อ
git log -p | grep -nEi 'token|secret|password|api[_-]?key' | head            # secret ในประวัติ
command -v clamscan && clamscan -r --infected .                              # ถ้ามี ClamAV
```
ถ้าไม่มี ClamAV ให้บอก AY ตรงๆ: นี่คือการตรวจโค้ดอันตรายด้วย pattern ไม่ใช่โปรแกรมแอนตี้ไวรัสเต็มรูปแบบ
สรุป **ผ่าน** / **ไม่ผ่าน (ห้าม merge)** + ระดับความเสี่ยง (สูง/กลาง/ต่ำ) ต่อข้อ
