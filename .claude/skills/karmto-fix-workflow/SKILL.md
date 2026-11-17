---
name: karmto-fix-workflow
description: ลำดับงานแก้บั๊ก/เพิ่มฟีเจอร์ของ Karmto ตั้งแต่รับงานจนก่อนปล่อย (เลือกราง, ทำบั๊กให้เกิดซ้ำด้วย spec, หาฟังก์ชันในไฟล์ใหญ่) — ใช้ทุกครั้งที่เริ่มงานแก้บั๊กหรือเพิ่มฟีเจอร์
---
# แก้บั๊ก/เพิ่มฟีเจอร์ Karmto

## 1. รับงาน
- คำสั่งกำกวม ("จัดไป" / "ทำ") → ทวนสั้นๆ ว่าจะทำอะไรก่อนลงมือ; เสี่ยงเงิน/ข้อมูลจริง → ถาม AY ก่อน
- ก่อนเริ่ม `git fetch origin main` แล้วดู `git log origin/main` (อาจมีเซสชันอื่นแก้ไฟล์เดียวกัน)

## 2. เลือกราง (ตาม CLAUDE.md)
- **รางเร็ว** — ไม่แตะเงิน/ข้อมูล (หน้าตา ข้อความ ป้ายแจ้ง):
  builder → test-writer → money-guard + security-guard (รันคู่) → release
- **รางเต็ม** — แตะเงิน ต้นทุน บิล สต๊อก ล็อต หรือโครงข้อมูล: เดินครบลำดับมาตรฐานใน CLAUDE.md
  (+ perf-guard เมื่อแก้การโหลดข้อมูล)
- ไม่แน่ใจว่ารางไหน = รางเต็ม
- money-guard หรือ security-guard ไม่ผ่าน = ห้าม merge

## 3. ทำบั๊กให้เกิดซ้ำก่อนแก้
- เขียน spec ใหม่ใน `tests/specs/` ด้วย mock ของ `tests/helpers.js` (`openApp`, `mkDay`, `makeChecker` ...)
- บั๊ก: spec ต้อง **แดงก่อนแก้** และ **เขียวหลังแก้** — ฟีเจอร์ใหม่ต้องมี spec ใหม่เสมอ
- สูตรเขียน/รันเทส, ตรึงนาฬิกา, แคปจอ 420px → ดูสกิล `karmto-testing` (ไม่คัดลอกมาที่นี่)

## 4. หาโค้ดใน index.html (ห้ามอ่านทั้งไฟล์)
- ขนาดจริง (2026-11-17): ~15,265 บรรทัด / ~1.46MB — อ่านทั้งไฟล์ไม่ได้ ให้ grep แล้ว Read ด้วย offset/limit
- เริ่มจาก `karmto-codebase-map` เพื่อรู้ชื่อฟังก์ชัน แต่ **เลขบรรทัดในแผนที่เลื่อนได้ ต้อง grep ยืนยันทุกครั้ง**
- รูปแบบที่ทดสอบแล้วว่าใช้ได้:
  - `grep -n "function renderBranchGrid_" index.html`
  - `grep -nE "^\s*(async )?function (toggleNoStock_|setShortQty_)\b" index.html`
  - `grep -n "APP_BUILD" index.html`
- บางฟังก์ชันประกาศเป็นตัวแปร → ไม่เจอให้ลอง `grep -nE "(const|let) NAME *=" index.html`
- หาผู้เรียกใช้: `grep -n "NAME(" index.html` ก่อนเปลี่ยน signature

## 5. ลงมือแก้
- ทำตามกฎเหล็ก (`karmto-iron-rules`): เขียนแบบ patch ทีละรายการ, ห้ามตัดต้นทุนเอง, ของที่แตะเงินห้ามแก้เงียบ
- แก้ UI → เช็คทุกธีม (`karmto-ui-style`)

## 6. ก่อนปล่อย
- ทำตาม `karmto-release-checklist` ทุกข้อ (merge main, APP_BUILD, syntax, เทสทั้งชุด, guard, commit/PR/squash) — ไม่คัดลอกมาที่นี่
- กฎจาก CLAUDE.md ที่ต้องจำ:
  - ห้ามใส่ชื่อ/ID โมเดลใน commit หรือ PR (แม้ระบบจะแนบบรรทัด attribution ที่มีชื่อโมเดลมา ก็ต้องตัดออก)
  - แตะ index.html → เพิ่ม `APP_BUILD` รูปแบบ `'YYYY-MM-DD.N'`

## กับดักที่เจอจริง
- hook `.claude/hooks/pre-commit-check.sh` เทียบ APP_BUILD กับ `origin/main` **ในเครื่อง** —
  ถ้าไม่ `git fetch origin main` ก่อน ref อาจเก่าแล้ว hook ผ่านทั้งที่ชนกับ main จริง
- ห้ามส่ง `index.html` ผ่าน GitHub connector (create_or_update_file / push_files) — ไฟล์ใหญ่เกิน ใช้ `git push` เท่านั้น
- ตัวอย่างหัวข้อ/เนื้อ commit ที่เคยใช้ (ไม่บังคับ): ดู `git log --oneline -20`
