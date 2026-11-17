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

## โครง spec ใหม่ขั้นต่ำ (ลอกจาก `short-delivery-bill.spec.js` / `no-stock-bill.spec.js`)
```js
const { launch, mkDay, openApp, makeChecker, stripBanner } = require('../helpers');
(async () => {
  const browser = await launch();                 // ผ่าน sandbox เสมอ (บล็อก script.google.com)
  const { check, finish } = makeChecker();
  const page = await openApp(browser, { store: { 'day:2026-11-16': mkDay({ orders: { '21': { p1: 2 } } }) }, date: '2026-11-16' }); // 420px เป็นค่าเริ่มต้น
  await page.clock.setFixedTime(new Date('2026-11-16T10:00:00+07:00'));
  // ... evaluate/คลิก แล้ว check('ข้อความ', เงื่อนไข, ค่าที่อยากเห็นตอนพัง)
  await finish(browser);                          // exit 1 ถ้ามี FAIL — run-all ตัดสินจาก exit code
})();
```
- ชื่อไฟล์ `tests/specs/<เรื่อง>.spec.js` → `run-all.js` เก็บเอง ไม่ต้องลงทะเบียนที่ไหน
- mock: ใช้ `installMockStorage` ใน `helpers.js` เท่านั้น (รองรับ patchOps ทุกแบบ: push/remove/matchField+set/nested/path+value/deleteKey/rootIsArray)
  ห้ามเขียน mock เอง และห้ามลอก spec รุ่นเก่า 24 ไฟล์ที่ไม่ใช้ helpers (`grep -L helpers tests/specs/*.js`) — mock ในนั้นรองรับไม่ครบ
- `window.__writes` = `{op:'set'|'patchField'|'patchOps', key, path|ops}` (get/list/delete/bulkSet ไม่จด) — ล้าง `window.__writes = []` ก่อนกด
  แล้ว**กรองด้วย key เสมอ** เพราะ mock ถูกห่อด้วย `wrapStorageForDayRevs_` อัตโนมัติ จึงมีการเขียน `dayRevs` ติดมาด้วย
- โค้ด `backend/*.gs`: ไม่ต้องเปิดเบราว์เซอร์ — โหลดไฟล์เข้า `vm` + จำลองบริการ Apps Script (ดู `line-bot-backend.spec.js`)
- แคปจอ: `path.join(process.env.SHOT_DIR || tests/screenshots, 'x.png')` + `.catch(()=>{})` — `tests/screenshots/` อยู่ใน `.gitignore` ไม่ต้อง commit
- "วันนี้" ต้องเป็นเวลาไทย ไม่ใช่ UTC ของเครื่องรัน (เคยพังมาแล้ว) → ตรึงนาฬิกาด้วย `+07:00`
- รอผลด้วย `page.waitForFunction(() => <สถานะจริง>)` แบบที่ไฟล์ใหม่ใช้ แทน `waitForTimeout(ms)` ในไฟล์เก่า (เป็นแนวทาง ยังไม่มีหลักฐานว่าเคย flaky)

## สคริปต์ช่วยตรวจ (อยู่ใน `scripts/` ของสกิลนี้)
- `mobile-overflow-sweep.js [width]` — ทุกแท็บ × ทุกธีม/โหมด ที่จอมือถือ ต้องขึ้น `NO OVERFLOW` (รันทุกครั้งที่แก้ CSS/เลย์เอาต์)
- `theme-screenshots.js <tab> <outDir> [selector] [width]` — แคปทุกธีมไว้ดูด้วยตา (ดูภาพจริงทุกครั้ง อย่าเชื่อแค่ตัวเลข)
- `ocr-real-images.js <รูป...>` — วัดผลตัวอ่านรูปออเดอร์กับรูปจริงที่ AY ส่งมา
รันจาก `tests/`: `NODE_PATH=/opt/node22/lib/node_modules PW_CHROMIUM_PATH=/opt/pw-browsers/chromium node ../.claude/skills/karmto-testing/scripts/<ไฟล์>`

## บทเรียนที่เจอจริง
- เซิร์ฟเวอร์ 8765 ตายเองบ่อยเมื่อเครื่องว่าง → `ERR_CONNECTION_REFUSED` = เปิดใหม่ ไม่ใช่บั๊กแอป (`run-all.js` เปิดให้เองอยู่แล้ว)
- `openApp` ใส่ข้อมูลหลังแอปบูตแล้ว → ของที่โหลดตอนบูต (เช่น `closedMonths`, `activityLog`) ต้องสั่งโหลดซ้ำในเทส (`await loadClosedMonths_()`)
- แคชรายชื่อคีย์ 60 วิ: เทสที่นับจำนวนครั้งเรียก list ต้อง `window.storage.__clearListCache()` ก่อน
- ฟังก์ชันที่กลายเป็น async (เช่น `addPurchToStage`) → เทสเดิมต้อง `await` ไม่งั้นอ่านค่าก่อนเสร็จ
- เทสที่ใช้ "วันนี้" แล้วพังเมื่อเปลี่ยนเดือน = ลืมตรึงนาฬิกา (`page.clock.setFixedTime`) ไม่ใช่บั๊กแอป
- ตรวจล้นจอด้วยตัวเลข: `document.documentElement.scrollWidth <= innerWidth`
