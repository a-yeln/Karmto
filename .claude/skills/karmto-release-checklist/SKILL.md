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

## ส่งงานหลังมีเซสชันอื่นทำงานคู่กัน
- ก่อนเริ่มและก่อน commit ดู `git log origin/main` — เซสชันอื่นอาจเพิ่มไฟล์เดียวกัน (เคยชนใน `CLAUDE.md`): อ่านทั้งสองฝั่งก่อนเลือก
  ฉบับใน main ที่ใหม่กว่าและ AY ยืนยันแล้ว (เช่น แผนที่ตัดบางข้อออก) ชนะ — แล้วเติมของเราเข้าไปแทนการทับ
- PR ค้างเก่าที่ชนกับ main (เช่น #113): เทียบว่าอะไรใน PR นั้นที่ main ยังไม่มี → ย้ายเฉพาะส่วนนั้นมาใน PR ใหม่พร้อมเทส แล้วปิด PR เก่า ไม่ merge ทับ

## push ไม่ผ่าน (403)
1. `git push` 403 → ลองซ้ำ 2–3 ครั้ง (2s/4s/8s); ลองผ่าน GitHub connector (create_or_update_file / push_files — ไฟล์ index.html ใหญ่ ~1.3MB ส่งทางนี้ไม่ได้)
2. ทั้งสองทาง 403 / "Resource not accessible by integration" = สิทธิ์เขียนของ Claude GitHub App — ให้ AY ไปที่
   https://github.com/settings/installations → Claude → Configure → ติ๊ก repo Karmto → Save (หรือ https://claude.ai/connect-github)
3. แก้แล้วยัง 403 = เซสชันถือสิทธิ์ชุดเก่า → **เก็บงานที่ยังไม่ขึ้นเป็น artifact ส่วนตัวก่อน** (CLAUDE.md/patch/spec ครบ พร้อมปุ่มคัดลอก)
   แล้วให้ AY เปิดเซสชันใหม่ส่งลิงก์นั้น — งานใน container จะหายเมื่อปิดเซสชัน ห้ามปล่อยให้หาย
4. บอก AY ทุกรอบแบบสั้น: ค้างกี่ commit มีอะไร ต้องทำอะไรต่อ — ไม่ทำเหมือนว่าส่งแล้ว

## หลัง merge
- อ่านการแจ้งเตือน PR ให้หมด (subscription/merged) แล้วบอก AY บรรทัดเดียวว่า merge แล้ว
- แนะนำเปิดเซสชันใหม่เมื่อแชทยาวจนถูกย่อความ — `CLAUDE.md` + สกิลพาความรู้ไปเอง ไม่ต้องวางข้อความยาว
