# Karmto (ก้ามโต) — คู่มือสำหรับ Claude

เว็บแอปสั่งอาหารทะเลรายวัน ออกบิลสาขา ต้นทุนซื้อ สต๊อก/ล็อต เคลม และค่า Brand fee ของทวีโชคหมูกะทะ
ไฟล์แอปมีไฟล์เดียวคือ `index.html` deploy จาก `main` ขึ้น GitHub Pages (https://a-yeln.github.io/Karmto/)
ข้อมูลจริงเก็บใน Google Apps Script (Sheets) — โค้ดฝั่งนั้นที่อยู่ใน repo มีแค่ `backend/*.gs` บางไฟล์ (Code.gs หลักไม่อยู่ใน repo)

## กฎเหล็ก (ห้ามฝ่าฝืนไม่ว่ากรณีใด)
- **อย่ามากระทบต้นทุนจริง อย่ามามั่ว** — ตัวเลขต้นทุน/บิล/สต๊อกต้องตรงของจริงเสมอ
- **ห้ามเอาจำนวนเบิกเข้ามาในรายการต้นทุนเองเด็ดขาดถ้าเจ้าของไม่ยืนยัน** — รอบเบิกล็อตใหม่ต้องเริ่มที่ `costedQty: 0`
  แล้วให้ผู้ใช้กด "✅ ตัด" เองในการ์ดตัดต้นทุนสต็อกล็อต ระบบห้ามตัดต้นทุนอัตโนมัติ
- เขียนข้อมูลแบบ patch ทีละรายการเท่านั้น (`writeDayArrayOp_`, `writeRootArrayOp_`, `writeDayFieldPath_`, `storage.patchOps`)
  ห้ามโหลดทั้งก้อนแล้ว `set` ทับ — หลายเครื่องใช้พร้อมกัน (iPhone / Android / แท็บเล็ต / คอม)
- ของที่แตะเงิน (ลบรายการจ่ายแล้ว, แก้บิลที่จ่ายแล้ว, แก้รอบเบิกที่ตัดต้นทุน/เคลมแล้ว) ห้ามแก้เงียบๆ — ให้บล็อกแล้วบอกให้ไปแก้ที่หน้าปกติ
  หรือถามยืนยันพร้อมโชว์ค่าเก่า/ใหม่

## วิธีทำงานกับเจ้าของ
- ตอบเป็นภาษาไทย สั้น ตรง บอกผลจริง (ผ่าน/ไม่ผ่าน/ยังไม่ได้ลองกับข้อมูลจริง)
- **เสนอและเพิ่มสิ่งที่ควรมีได้เลยไม่ต้องรอสั่ง** อันไหนไม่โอเคเจ้าของจะบอกเอง — แต่ถ้าเสี่ยงกับเงิน/ข้อมูลจริง ให้ถามก่อน
- **แนะนำทางที่ดีกว่าเสมอโดยไม่ต้องรอถาม** — รวมถึง **บอกให้ขึ้นเซสชันใหม่** เมื่อแชทยาวจนเริ่มถูกย่อความ (compact)
  หรือเปลี่ยนหัวข้องานใหญ่ พร้อมสรุปข้อความเปิดเซสชันใหม่ให้
- ถ้าคำสั่งกำกวม (เช่น "จัดไป" / "ทำ" ที่อาจหมายถึงหลายเรื่อง) ให้ทวนสั้นๆ ว่าจะทำอะไรก่อนลงมือ
- งานแต่ละรอบ: ทำ → เทส → commit → PR → squash merge เอง (เจ้าของอนุญาตไว้แล้ว) บน branch ที่เซสชันกำหนด

## ก่อน commit ทุกครั้ง
1. `git fetch origin main && git merge origin/main --no-edit`
2. เพิ่ม `APP_BUILD` ใน `index.html` (รูปแบบ `'YYYY-MM-DD.N'`) — มือถือใช้ค่านี้เช็คว่ามีเวอร์ชันใหม่แล้วรีโหลดเอง
3. เช็ค syntax ของ inline scripts: `node tests/check-syntax.js`
4. รันเทสครบทุก spec ให้ผ่าน
5. ห้ามใส่ชื่อ/ID โมเดลใน commit หรือ PR

## ทีม Agent (`.claude/agents/karmto-*.md`) + สกิล (`.claude/skills/karmto-*`)
14 ตัว: `ay-proxy` (ตัวแทน AY, โหมดเงา) • `manager` (วางแผน/แจกงาน/ตัดสิน/สรุป) • `designer` • `plan-reviewer` (รีเช็คก่อนเขียนจริง) •
`builder` • `gs-backend` • `bug-hunter` • `test-writer` • `ui-checker` • `money-guard` • `security-guard` (ความปลอดภัยสูงสุด) • `release` •
`accountant` (บัญชี/กระทบยอด/P&L/cashflow/หนี้, อ่านอย่างเดียว) • `data-auditor` (กรอกครบ + ตัดต้นทุนล็อตย้อนหลัง, อ่านอย่างเดียว)
— ตัวรองที่ยังไม่สร้างอยู่ใน `.claude/agents/RESERVE.md`
- สกิล 12 ตัว (agent โหลดอัตโนมัติผ่าน frontmatter `skills:`): `karmto-iron-rules` • `karmto-ay-way` • `karmto-codebase-map` • `karmto-testing` •
  `karmto-ui-style` • `karmto-money-review` • `karmto-security-audit` • `karmto-reconcile` • `karmto-lot-costing` • `karmto-apps-script` • `karmto-release-checklist` •
  `karmto-order-ocr` (อ่านรูปออเดอร์) — สคริปต์ตรวจล้นจอทุกธีม/แคปจอ/วัด OCR อยู่ใน `.claude/skills/karmto-testing/scripts/`
  — เมื่อโค้ดเปลี่ยนมาก (เช่น บรรทัดใน codebase-map เลื่อน) หรือ AY ติ๊ก ❌ ให้อัปเดตสกิลที่เกี่ยวข้อง นี่คือวิธี "เทรน" ทีม
- ลำดับงานมาตรฐาน: manager → designer → ay-proxy → builder (แผนแก้) → plan-reviewer → builder (ลงมือ, +gs-backend) → test-writer →
  bug-hunter (ถ้าเทสแดง) → ui-checker → money-guard → security-guard → release → manager สรุป → Claude หลัก commit/PR/squash merge
- **money-guard หรือ security-guard ไม่ผ่าน = ห้าม merge**; subagent เรียก subagent ต่อไม่ได้ — Claude หลักเป็นคนแจกงานตามใบสั่งงานของ manager
- ตัวแทน AY อ่าน `.claude/ay-proxy/profile.md` และบันทึกความเห็นใน `.claude/ay-proxy/decisions.md` ให้ AY ติ๊ก ✅/❌ — ยังไม่มีสิทธิ์ตัดสินจริง
- งานเล็ก (แก้คำ/สีจุดเดียว) ไม่ต้องเดินครบทุกตัว แต่ test-writer + money-guard + security-guard + release ต้องมีเสมอเมื่อแตะ index.html หรือ backend

## เทส
- Playwright specs ใน `tests/specs/*.spec.js` ใช้ `tests/helpers.js` (mock `window.storage` ในหน่วยความจำ: `window.__store`, `window.__writes`)
  และ `tests/sandbox.js` (บล็อก backend จริงเสมอ — ห้ามให้เทสแตะข้อมูลจริง)
- รันทั้งชุด: `cd tests && NODE_PATH=/opt/node22/lib/node_modules node run-all.js` (เปิดเซิร์ฟเวอร์ให้เอง)
- รันทีละไฟล์: เปิด `cd /home/user/Karmto && python3 -m http.server 8765 &` ก่อน แล้ว
  `cd tests && NODE_PATH=/opt/node22/lib/node_modules PW_CHROMIUM_PATH=/opt/pw-browsers/chromium node specs/X.spec.js`
  (เซิร์ฟเวอร์มักโดนปิดเมื่อเครื่องว่าง — ถ้าเจอ ERR_CONNECTION_REFUSED ให้เปิดใหม่)
- เทสที่อิง "วันนี้" ต้องตรึงนาฬิกา: `await page.clock.setFixedTime(new Date('YYYY-MM-DDT10:00:00+07:00'))`
- ฟีเจอร์ใหม่ต้องมี spec ใหม่เสมอ และเช็คหน้าตาด้วย screenshot บนจอมือถือ (420px) อย่างน้อย 1 ธีม

## โครงสร้างสำคัญใน index.html
- `window.storage` (get/set/list/delete/patchField/patchOps) → Apps Script; ถูกห่อด้วย `wrapStorageForDayRevs_` ซึ่งทำ:
  ป้าย `dayRevs` ต่อวัน (ซิงค์ข้ามเครื่อง), เตือนขนาดคีย์ใกล้ 50,000 ตัวอักษร, ล็อกปิดเดือน (`closedMonths`),
  คิวบันทึกออฟไลน์ (`karmto_offline_queue`), แคชรายชื่อคีย์ 60 วินาที
- ข้อมูลรายวัน `day:YYYY-MM-DD` (orders, purchases, expenses, leftoverOut/leftoverSince, billingPaid, billExtra ...)
- คีย์รวม: `rawLots` (ล็อต + draws: qtyUsed/sellableQty/costedQty/claimedQty), `lotProductBills`, `lotTransportBills`,
  `wasteRecords` (reason 'waste'|'claim', lotClaimAllocations), `settings`, `actlog:YYYY-MM-DD`, `rchkm:*`/`rchk:*`, `productImage:*`
- สินค้า `PRODUCTS` p1–p7 มี `shop` (monk=มนต์, mahkard=ม๊ะก๊าด, phat=พัฒน์); หอยนางรม (p7) ซื้อเป็น กก. ขายเป็นกระปุก
- ธีม: `data-theme` (mermaid/sea/neon, ไม่มี = macaron), `data-tmode` (full/color), `data-bill` — เช็คทุกธีมเมื่อแก้ UI
- ถ้าเพิ่มคีย์ใหม่ที่ต้องสำรอง ให้เพิ่มใน `BACKUP_EXTRA_ROOT_KEYS` / `BACKUP_PREFIXES` และ `backend/BackupTrigger.gs`

## ทำไปแล้ว (ไม่ต้องทำซ้ำ)
ธีม Mermaid/Sea/Neon • หน้า Notifications • ฟอร์มจดสต๊อก + ซิงค์ทีละวัน/ปิดงวด • ล็อกปิดเดือน • คิวบันทึกออฟไลน์ •
รหัสเข้าใช้ระบบ (`backend/AuthGuard.gs`) • คาดการณ์ยอดสั่ง 🔮 • กำไรแยกสินค้า/สาขาใน P&L • เตือนราคาซื้อพุ่ง •
ชื่อเครื่องในรายการกิจกรรม • ปุ่ม 📋 ดึงยอดออเดอร์ + รันสินค้าถัดไปในการ์ดซื้อ • อ่านรูปออเดอร์ (OCR ไทยล้วน + ขยายภาพ) •
🧭 ศูนย์บัญชาการ "วันนี้" บนแดชบอร์ด • เตือนกำไรหดตอนกรอกซื้อ

## ค้างฝั่งเจ้าของ
- ตั้ง `KARMTO_KEY` ใน Apps Script ตามขั้นตอนหัวไฟล์ `backend/AuthGuard.gs` (ยังไม่ตั้ง = ระบบใช้ได้เหมือนเดิม)

## แผนถัดไป (AY ยืนยันก่อนเริ่มแต่ละตัว)
1. ✅ เช็คลิสต์ "กรอกครบวันนี้" + วันย้อนหลังที่ขาด (บนศูนย์บัญชาการ 🧭)
2. 🧮 ผู้ช่วยตัดต้นทุนล็อตย้อนหลัง — แสดงรอบที่ยังไม่ตัด/ตัวเลขชวนสงสัย ให้ AY กด ✅ ตัด เอง
3. 💰 บัญชีในแอป: กระทบยอดโอน, P&L สัปดาห์/ปี, cashflow, หนี้
4. 🎬 อินโฟกราฟิกเคลื่อนไหว (สมจริง ไม่ใช่ตัวอักษรขยับ) อธิบายฟอร์มแทนข้อความยาว
5. 🤖 AI ที่ปรึกษาในแอป (ต้องมี LLM key ผ่าน Apps Script — ถาม AY เรื่อง key/ค่าใช้จ่าย)
6. 💬 บอท LINE ฝังในกลุ่มแบบเงียบ (Messaging API → `backend/LineBot.gs` web app แยก) — ไม่ตอบ/ไม่ส่งอะไรในกลุ่ม; ปกติกลุ่มส่งแต่รูป
   - รูปสลิป → อ่านยอด/วันที่/ผู้โอน (OCR) ลง `lineInbox:YYYY-MM-DD` ให้ AY จับคู่กระทบยอดกับบิลในแอปเอง — ไม่เช็ค QR, ไม่ใช้บริการตรวจสลิปเสียเงิน
   - รูปออเดอร์ → อ่านแล้วร่างไว้ในหน้าออเดอร์ (ใช้ตัวอ่านรูปออเดอร์เดิม) ให้ AY กดยืนยันเอง — ห้ามบันทึกเอง
   - รูปบิล → ข้าม ไม่เก็บ (AY ส่งบิลจากแอปเองอยู่แล้ว)
   - มีคนพิมพ์ข้อความในกลุ่ม → แจ้ง AY ทันทีทางแชทส่วนตัว + หน้า Notifications
   - ไม่ตัดยอดจ่าย/บันทึกเงินเอง; ถาม AY เรื่องงบ LINE OA (โควตา push) ก่อนเริ่ม
- ตัดออกแล้ว (AY ว่าไม่จำเป็น): จัดอันดับสาขา • เฝ้าราคาผู้ขาย • แนะนำจำนวนซื้อ
