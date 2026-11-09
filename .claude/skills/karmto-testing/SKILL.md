---
name: karmto-testing
description: สูตรเขียนและรันเทส Playwright ของ Karmto (mock storage, ตรึงนาฬิกา, ตรวจการเขียนที่ไม่ควรเกิด) — ใช้เมื่อเขียน spec ใหม่ ไล่บั๊ก หรือเตรียมปล่อยงาน
---
# เทส Karmto

- spec เป็นสคริปต์ Node อิสระใน `tests/specs/*.spec.js` — ลอกโครงจาก spec ใกล้เคียงที่สุด (อ่าน `tests/README.md`)
- ใช้ `tests/helpers.js` (mock `window.storage` → `window.__store`, บันทึกการเขียนใน `window.__writes`) และ `tests/sandbox.js` (บล็อก backend จริง)
- `patchOps` ถูกเรียก 2 แบบ (op ของ day กับ root array) — mock ต้องรองรับทั้งคู่ (ดู README)
- อิง "วันนี้" ต้องตรึง: `await page.clock.setFixedTime(new Date('YYYY-MM-DDT10:00:00+07:00'))`
- เคสที่ต้องมีเสมอเมื่อแตะเงิน: ตรวจ `window.__writes` ว่า **ไม่มี** การเขียน `costedQty`/บิลที่ไม่ได้สั่ง, เดือนปิดแล้วถูกบล็อก, ข้อมูลว่าง
- เช็คหน้าตา: แคป 420px อย่างน้อย 1 ธีม
- รัน: ทั้งชุด `cd tests && NODE_PATH=/opt/node22/lib/node_modules node run-all.js`
  ทีละไฟล์: `python3 -m http.server 8765 &` ที่ root แล้ว `cd tests && NODE_PATH=/opt/node22/lib/node_modules PW_CHROMIUM_PATH=/opt/pw-browsers/chromium node specs/X.spec.js`
- รายงานจำนวน PASS/FAIL จริง ห้ามบอกว่าผ่านถ้ายังไม่ได้รัน; บั๊กต้องมี spec ที่แดงก่อนแก้และเขียวหลังแก้
