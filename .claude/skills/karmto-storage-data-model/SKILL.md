---
name: karmto-storage-data-model
description: โครงข้อมูลและชั้น storage ของ Karmto (window.storage, ตัวห่อ wrapStorageForDayRevs_, ตัวช่วยเขียนแบบ patch, รายการคีย์ day:/คีย์รวม/คีย์แยกชิ้น, การสำรอง, แพทเทิร์นกันข้อมูลเก่า/เขียนชนข้ามเครื่อง) — ใช้ก่อนเพิ่มคีย์ใหม่ เพิ่มฟิลด์ในวัน เขียนข้อมูลชนิดใหม่ หรือไล่บั๊ก "ข้อมูลหาย/เด้งกลับ/ไม่ตรงข้ามเครื่อง"
---
# Storage และโครงข้อมูล Karmto

ไม่ใส่เลขบรรทัด (เลื่อนบ่อย) — หาด้วย `grep -n "ชื่อฟังก์ชัน" index.html` ก่อนอ้างเสมอ
ไม่ซ้ำกับสกิลอื่น: กฎ `costedQty: 0`/ห้ามแก้เงินเงียบๆ → **karmto-iron-rules** · โครง draws/FIFO เคลม → **karmto-lot-costing** ·
แผนที่ฟังก์ชันทั้งไฟล์ → **karmto-codebase-map** · mock storage ในเทส → **karmto-testing**

## 1. window.storage → Apps Script `/exec`
| เมธอด | ทำอะไร |
|---|---|
| `get(key)` | คืน `{value: สตริง JSON}`; error ทุกแบบฝั่งเซิร์ฟเวอร์กลายเป็น `'Key not found: '` → เช็ค `indexOf('Key not found')===0` ก่อนถือว่า "ยังไม่มีข้อมูล" (`loadDay`) |
| `set(key, value)` | เขียนทับทั้งก้อน ไม่มีล็อก |
| `list(prefix)` / `delete(key)` | รายชื่อคีย์ตาม prefix / ลบคีย์ |
| `patchField(key, path, value)` | แก้ฟิลด์เดียวตาม path ใต้ล็อกฝั่งเซิร์ฟเวอร์ (Code.gs v4+) คืนค่าทั้งก้อนหลัง merge |
| `patchOps(key, ops, rootIsArray)` | หลาย op ในคำขอเดียวใต้ล็อกเดียว (v5+); `rootIsArray:true` เมื่อค่าทั้งคีย์เป็นอาเรย์ |
- `bulkSetStorageImpl` / `bulkGetStorageImpl` ยิงตรง **ไม่ผ่านตัวห่อ** (ใช้ตอนนำเข้า/`loadDaysBulk`)
- รูป op ที่ใช้จริง (กระจกฝั่งเครื่อง `localPatchOps_`, `localApplyArrayOp_`): `{path,value}` · `{path,deleteKey:true}` ·
  `{arrayPath, push}` · `{arrayPath, remove:{matchField,matchValue,matchAll?}}` · `{arrayPath, matchField, matchValue, matchDefault?, matchAll?, set, nested:{field, push|remove|set...}}`
  — ความหมายจริงอยู่ใน `patchOps_` ของ Code.gs (นอก repo)

## ตัวห่อ `wrapStorageForDayRevs_` — ห่อ set/patchField/patchOps/delete ตามลำดับ
1. **ล็อกปิดเดือน** `monthLockBlocks_`: คีย์ `day:` ในเดือนที่ปิด → throw `err.monthLocked`; ยกเว้น patch ที่แตะเฉพาะ
   `MONTH_LOCK_FREE_FIELDS` (billingPaid, purchaseGroupPayment, billNote, billClaimNotes, messageOverrides, workflow)
   หรือ `set` แค่ paid/paidDate/paidAmount; `rawLots`/`wasteRecords` บล็อกเมื่อ push รายการที่ `date`/`buyDate` อยู่ในเดือนปิด
2. **คิวออฟไลน์** `karmto_offline_queue`: ออฟไลน์หรือคิวยังไม่ว่าง → `queueOfflineWrite_` รับเฉพาะ patchField/patchOps
   ที่ `offlineBase_` รู้ค่าฐาน (day:, rawLots, wasteRecords, lotProductBills, lotTransportBills, debts, settings, actlog:) อื่นๆ throw `e.offline`;
   push ที่มี `id` ถูกแปลงเป็น remove+push (`idempotentOps_`) ส่งซ้ำไม่ซ้ำ; `flushOfflineQueue_` ส่งตามลำดับ แล้วล้างแคช root
   — `set` ตอนออฟไลน์ = throw เสมอ
3. หลังเขียนสำเร็จ: `stamp` สุ่มป้ายวันลง `dayRevs` (เฉพาะคีย์ `day:`; รวมส่งทุก 400ms ผ่าน `pushDayRev_`),
   `noteStorageSize_`, ยิง event `karmto-saved`, อัปเดตแคชรายชื่อคีย์
4. **ขนาดคีย์**: เซลล์ Sheets ~50,000 ตัวอักษร เกินแล้วบันทึกไม่ได้เงียบๆ; เกิน `STORAGE_SIZE_WARN = 42000` ขึ้นในหน้า Notifications
   ทั้งตอน get และเขียน
5. **แคชรายชื่อคีย์** `list` จำ 60 วินาที (`STORAGE_LIST_TTL`), เพิ่ม/ลบเองเมื่อเครื่องนี้เขียน (`__noteKey`), ล้างด้วย `__clearListCache`
- แคชวัน: `dayCache_` + localStorage `karmto_dayc2:`; `loadDay` โหลดสดเสมอเฉพาะ 3 วันล่าสุด (`isRecentDay_`) วันเก่ากว่าใช้แคช
  จนกว่า `syncDayRevs_` เห็นป้ายเซิร์ฟเวอร์ไม่ตรงแล้วทิ้งแคชวันนั้น; โหลดพังแต่มีแคช → คืนแคช, ไม่มีแคช → throw (กันเขียนทับด้วยวันว่าง)

## 2. ตัวช่วยเขียน — เลือกตามรูปข้อมูล
| เขียนอะไร | ใช้ | ตัวอย่างจริง |
|---|---|---|
| ฟิลด์/ค่าตรงในวัน | `writeDayFieldPath_(iso, path, v)` | `['billExtra', code]`, `['shortQty',code,pid]` |
| รายการในอาเรย์ของวัน | `writeDayArrayOp_(iso, field, op)` | `'expenses', {push: expense}` |
| คีย์ที่เป็นอาเรย์ทั้งก้อน | `writeRootArrayOp_(key, op, setCache)` | `'wasteRecords', {push:wasteEntry}` |
| ฟิลด์เดียวของ settings | `writeSettingsFieldPath_(path, v)` | `['priceHistory', pid]` |
| หลายจุดต้องตรงกัน (atomic) | `storage.patchOps` ตรง หรือส่ง op เป็นอาเรย์ | `writePurchaseGroupPaid_` |
| สถานะจ่าย | `writeBillingPaid_` / `writeExpensePaid_` / `writeLotBillPaid_` | |
```js
// ✅ ถูก — ใช้ค่าที่เซิร์ฟเวอร์ merge แล้วคืนมา
const fresh = await writeDayArrayOp_(iso, 'expenses', {push: expense});
if(iso===currentDate) dayData = fresh;
// ❌ ผิด — แก้ dayData ในเครื่องแล้ว set ทั้งวัน: dayData อาจเก่าเป็นนาที เครื่องอื่นที่เขียนวันเดียวกันระหว่างนั้นหายเงียบ
dayData.expenses.push(expense); await saveDay(iso, dayData);
// ❌ ผิดแบบที่เคยเกิด (e0e4549) — เขียน patch ถูกแล้วแต่ทิ้งค่าที่คืนมา ไปแปะ billingPaid ลง dayData เก่าแทน
```
- `saveDay` **ไม่มีผู้เรียกแล้ว** และ `saveSettings` เหลือแค่ตอนนำเข้า — อย่าเพิ่มผู้เรียกใหม่
- `writeSettingsFieldPath_(['branches'], settings.branches)` ยังส่งอาเรย์ทั้งฟิลด์จากหน่วยความจำ → แก้ได้แค่ "ทีละฟิลด์" ไม่ใช่ทีละรายการ

## 3. รายการคีย์
**`day:YYYY-MM-DD`** (สำรอง) — ฟิลด์ตาม `emptyDay` / `normalizeDay_`: `orders`, `leftoverOut`, `leftoverSince`, `billingPaid`,
`billExtra`, `billNote`, `billNoteShowOnBill`, `billClaimNotes`, `noStock{all,branch}`, `shortQty`, `expenses[]`, `personalIncome[]`, `personalExpense[]`,
`purchases[]`, `purchaseGroupPayment`, `messageOverrides`, `feeNote`, `dashNote` — ฟิลด์ใหม่ต้องเติมค่าเริ่มต้นใน `normalizeDay_` (วันเก่าไม่มีฟิลด์นี้)

| คีย์ | รูป | สำรอง | หมายเหตุ |
|---|---|---|---|
| `settings` | object | ✅ (แยก) | `writeSettingsFieldPath_` |
| `debts` | อาเรย์ | ✅ (แยก) | `writeRootArrayOp_('debts',…)` |
| `rawLots`, `lotProductBills`, `lotTransportBills`, `wasteRecords` | อาเรย์ | ✅ | แคช `rawLotsCache_` ฯลฯ |
| `activityLog`, `billingRecheckCurrent`, `billingRecheckHistory` | เดิม | ✅ | ของเก่า ยังอ่าน; ของใหม่แยกคีย์ข้างล่าง |
| `supplierShortfalls`, `slipPayers` | อาเรย์ | ✅ | |
| `stockFormDraft`, `stockFormLastSync` | object | ✅ | `SF_DRAFT_KEY` / `SF_UNDO_KEY` (`set`) |
| `closedMonths` | `{YYYY-MM:{at,dev}}` | ✅ | `writeClosedMonth_` patchOps, `set` เฉพาะตอนยังไม่มีคีย์ |
| `actlog:YYYY-MM-DD` | อาเรย์ | ✅ prefix | `ACT_LOG_PREFIX` แยกวันกันเต็ม 50k |
| `rchkm:<รอบ>:<บิล>`, `rchk:<รอบ>:<n>` | object | ✅ prefix | ทีละบิล / ก้อนละ 100 บิล (43615f7) |
| `productImage:<pid>` | dataURL | ✅ prefix | `productImageKey_` |
| `lineInbox:YYYY-MM-DD` | อาเรย์ | ✅ prefix | บอทเขียน; แอปแก้แค่ป้าย dismissed/matched |
| `lineOrders:YYYY-MM-DD` | อาเรย์ | ❌ | ร่างจากบอท `LINE_ORDERS_PREFIX` |
| `dayRevs` | `{iso: ป้าย}` | ❌ | ป้ายซิงค์ สร้างใหม่ได้ |
| `lotSettleLock` | `{dev,ts,token}` | ❌ | กุญแจชั่วคราว 20 วิ |
คีย์ฝั่งเครื่อง (localStorage ไม่ขึ้นเซิร์ฟเวอร์): `karmto_dayc2:`, `karmto_dayrev:`, `karmto_offline_queue`, `karmto.deviceId`, `karmto.apiKey`

## 4. การสำรอง — แก้คู่กันเสมอ
- index.html: `BACKUP_EXTRA_ROOT_KEYS`, `BACKUP_PREFIXES` → ใช้ใน `exportAllData` และ `importAllData`
- backend/BackupTrigger.gs: `var BACKUP_EXTRA_ROOT_KEYS` + **อาเรย์ prefix เขียนตรงในบรรทัด** (ใน `runDailyKarmtoBackup`); `settings`/`debts` อยู่
- `node tools/check-skills.js` ข้อ (ง) เทียบ **เฉพาะ** `BACKUP_EXTRA_ROOT_KEYS` สองไฟล์ — prefix ต้องเทียบเองด้วยตา
- นำเข้าใช้ `bulkSetStorageImpl` (ไม่ผ่านตัวห่อ = ไม่สแตมป์ dayRevs/ไม่เช็คปิดเดือน) และ `set` คีย์รวมทั้งก้อน — ตั้งใจทับทั้งหมด

## 5. ข้อมูลเก่า (stale) และการเขียนชนข้ามเครื่อง
**แพทเทิร์นที่ใช้อยู่จริง**
- ใช้ค่าที่ patch คืนมาแทนของในเครื่องเสมอ (`fresh` → `dayData`, `setCache(arr)`, `settings = JSON.parse(res.value)`)
- เงินที่แก้ได้เฉพาะบิลยังไม่จ่าย: อ่านวันสดด้วย `storage.get('day:'+iso)` (ไม่ใช่ `loadDay` ที่อาจคืนแคช) → เช็ค `billingPaid` →
  เขียน → **เช็คซ้ำบนค่าที่คืนมา** ถ้าเพิ่งถูกติ๊กจ่ายให้ย้อนค่า (`setShortQty_`, `toggleNoStock_`) + ธง `noStockBusy_` กันกดซ้อน
- ตัดต้นทุนล็อต `confirmLotSettle_`: กุญแจข้ามเครื่อง `acquireLotSettleLock_` → `rawLotsCache_ = null` อ่านสด →
  เขียน nested set ทีละรอบเบิก → พังแล้วเช็คก่อนว่ารายการซื้อถึงเซิร์ฟเวอร์จริงไหม → rollback แบบ **ค่าปัจจุบันสด − delta** ไม่ตั้งค่าเดิมตรงๆ
- งานเบื้องหลังที่อาจรันซ้อน: ธง in-flight (`claimsLinkInFlight_` ใน `ensureClaimsLinkedToLots_`) + เช็ค "ทำแล้วหรือยัง" ก่อนเขียน
- ซิงค์ข้ามเครื่อง: `syncFromOtherDevices_` ทุก 60 วิ (`setInterval`) → `syncDayRevs_` + โหลดวันปัจจุบันใหม่ถ้าต่าง
**บั๊กที่เคยเกิด**
- 7a8dd54 (#98): เคลม 2 กก. ค้างตัดขึ้น 4 — backfill เคลมรันซ้อน + เขียน wasteRecords ทับทั้งก้อน (spec `claim-race-fix`)
- e0e4549: ติ๊กจ่ายทิ้งค่าที่ merge แล้ว แปะลง dayData เก่า; แก้หนี้อ่านจากแคช `loadDebts` แล้วทับรายการจ่ายจากอีกเครื่อง
  (spec `billing-paid-stale-data-and-batch-split`, `debt-edit-stale-cache-and-import-backfill`)
- 5340f1e/110bb38: เครื่องอื่นไม่เห็นบิลที่แก้ → เพิ่มป้าย `dayRevs` และโหลดวันปัจจุบันใหม่ตอนกลับเข้าแอป
- 66e1844: ไอโฟนแก้ 97→95 แต่แอนดรอยด์ยังโชว์ 97 จากแคชก่อนมีป้าย → `DAY_CACHE_EPOCH` ล้างแคชครั้งเดียว
- 43615f7: ตัดต้นทุนล็อตจากแคชเก่าเขียน costedQty ค่าสัมบูรณ์ทับอีกเครื่อง/ตัดซ้ำ; rollback ลบงานเครื่องอื่น (spec `lot-settle-cross-device`);
  แยกคีย์ rchk + เตือนขนาด (spec `storage-sharding-size-warn`)
**ช่องว่างที่ยังเหลือ**
- ความ atomic ของ patchField/patchOps อยู่ใน Code.gs ซึ่ง **ไม่อยู่ใน repo** — ตรวจ/เทสจริงไม่ได้ เทสใช้ mock เท่านั้น
- `acquireLotSettleLock_` เป็น get→set→get ฝั่งเครื่อง ไม่ใช่ล็อกเซิร์ฟเวอร์ — ลดโอกาสชน ไม่ได้ปิด 100%
- ป้าย `dayRevs` ครอบแค่ `day:` — คีย์รวม (rawLots, wasteRecords, lot bills, debts, settings) ใช้แคชในหน่วยความจำจนกว่าจะล้าง/รีโหลด
  → ก่อนเขียนเงินจากคีย์รวมต้องตั้งแคชเป็น null แล้วโหลดสดเอง
- ย้อนค่าใน `setShortQty_`/`toggleNoStock_` เขียนค่าเดิมแบบสัมบูรณ์ (ไม่ใช่ delta) — ถ้าเครื่องอื่นแก้ช่องเดียวกันระหว่างนั้นจะถูกทับ
- นำเข้าสำรองไม่สแตมป์ dayRevs → เครื่องอื่นอาจยังโชว์วันเก่าจากแคชจนกว่าวันนั้นถูกเขียนอีกครั้ง

## 6. เช็คลิสต์ก่อนเพิ่มคีย์ใหม่ / เขียนข้อมูลชนิดใหม่
1. **สำรองไหม?** ใช่ → เพิ่มใน `BACKUP_EXTRA_ROOT_KEYS`/`BACKUP_PREFIXES` (index.html) **และ** BackupTrigger.gs แล้วรัน `node tools/check-skills.js`; ไม่ → เขียนเหตุผลในคอมเมนต์
2. **เขียนแบบ patch** ด้วยตัวช่วยในข้อ 2 และใช้ค่าที่คืนมา; ห้าม `set` ทั้งก้อนกับข้อมูลที่หลายเครื่องแก้
3. **ขนาด**: โตไม่จำกัดตามเวลา? → แยกคีย์ต่อวัน/ต่อชิ้น (แบบ `actlog:`, `rchkm:`) ให้ต่ำกว่า 42,000 ตัวอักษรเสมอ
4. **ปิดเดือน**: ฟิลด์ใหม่ในวันถูกล็อกโดยอัตโนมัติ — ถ้าต้องแก้ได้หลังปิดเดือน (เช่นสถานะจ่าย) ต้องถามเจ้าของก่อนเพิ่มใน `MONTH_LOCK_FREE_FIELDS`
5. **ออฟไลน์**: คีย์รวมใหม่ที่ต้องเขียนออฟไลน์ได้ → เพิ่มใน `offlineBase_`; push ต้องมี `id` (ให้ `idempotentOps_` ทำงาน); จุดแตะเงินให้บล็อกออฟไลน์แบบ `toggleNoStock_`
6. **ฟิลด์ใหม่ใน day:** → เติมค่าเริ่มต้นใน `emptyDay` + `normalizeDay_`
7. **เงิน/บิลที่จ่ายแล้ว**: อ่านสดจาก `storage.get` → เช็ค → เขียน → เช็คซ้ำ/ย้อน; มีธงกันกดซ้อน
8. **เทส**: spec ใหม่ใช้ `tests/helpers.js` แล้วตรวจ `window.__writes` ว่ามีแต่ `patchField`/`patchOps` ไม่มี `{op:'set', key}` ของคีย์ที่ห้ามทับ
   และจำลอง "อีกเครื่องเขียนก่อน" ผ่าน `window.__store` แบบ spec `billing-paid-stale-data-and-batch-split`
