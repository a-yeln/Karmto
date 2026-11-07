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

## เช็คลิสต์ diff
1. HTML injection: ค่าใหม่ที่ใส่ใน `innerHTML`/`insertAdjacentHTML`/template ผ่าน `escapeHtml` ครบไหม
2. ไม่มี `eval`, `new Function`, `document.write`, `setTimeout/setInterval` แบบ string
3. สคริปต์ภายนอก: โดเมนที่รู้จัก + ล็อกเวอร์ชันชัด
4. Secret: `git diff` และไฟล์ใหม่ไม่มี token/key/รหัส (`grep -nEi 'token|secret|api[_-]?key|password|Bearer '`)
5. Apps Script: ทุก endpoint ตรวจ `KARMTO_KEY` (AuthGuard); webhook LINE ตรวจ `X-Line-Signature` ด้วย channel secret จาก Script Properties
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
