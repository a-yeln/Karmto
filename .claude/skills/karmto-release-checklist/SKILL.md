---
name: karmto-release-checklist
description: ขั้นตอนก่อน commit/PR/merge ของ Karmto — ใช้ทุกครั้งก่อนปล่อยงาน
---
# ปล่อยงาน Karmto

1. `git fetch origin main && git merge origin/main --no-edit` (ชน → หยุดรายงาน)
2. แตะ `index.html` → เพิ่ม `APP_BUILD` (`'YYYY-MM-DD.N'`, วันเดียวกัน N+1)
3. `node tests/check-syntax.js`
4. `cd tests && NODE_PATH=/opt/node22/lib/node_modules node run-all.js` ผ่านทุก spec
5. money-guard **ผ่าน** และ security-guard **ผ่าน** (ไม่ผ่านตัวใดตัวหนึ่ง = ห้าม merge)
6. ข้อความ commit/PR ไม่มีชื่อ/ID โมเดล
7. ฟีเจอร์ใหม่ → อัปเดต "ทำไปแล้ว" ใน `CLAUDE.md`
8. commit → PR → squash merge (AY อนุญาตแล้ว) → ถ้า PR เดิม merge แล้ว เริ่ม branch ใหม่จาก main
