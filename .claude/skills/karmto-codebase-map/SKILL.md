---
name: karmto-codebase-map
description: แผนที่ฟังก์ชันหลักใน index.html ของ Karmto แยกตามหน้า (storage, ออเดอร์, ซื้อ, บิล, ล็อต, P&L, แดชบอร์ด, สำรอง, ธีม) — ใช้ก่อนออกแบบ/แก้/รีวิวโค้ด เพื่อหาของเดิมมาใช้ซ้ำ
---
# แผนที่ index.html (บรรทัดโดยประมาณ ±5, ณ 2026-11-17 — ยืนยันด้วย Grep ก่อนอ้างเสมอ)

## Storage
- `window.storage` get/set/delete/list/patchField/patchOps ~L42-105 → Apps Script (`SHEET_API_URL` L24, `apiKey_()` L27)
- day cache ใน localStorage ~L2643-2672, `pushDayRev_` L2674; ล็อกเดือน `isMonthClosed_`/`monthLockBlocks_` ~L2703-2736
- ออฟไลน์คิว `queueOfflineWrite_` L2807, `flushOfflineQueue_` L2826; `wrapStorageForDayRevs_` L2855
- `loadDay` L2932, `loadDaysBulk` L2956, `saveDay` L2987, `emptyDay` L2435
- เขียนเฉพาะจุด: `writeBillingPaid_` L2999, `writeDayArrayOp_` L3069, `writeDayFieldPath_` L3080, `writeRootArrayOp_` L3090

## ออเดอร์
`renderOrderList` L3380, `saveRow` L3432, ตั๋วออเดอร์ `buildOrderTicketHTML` L3476, `renderMessages` L4123
OCR รูปออเดอร์ (Tesseract): `getOcrWorker_` L3785, `parseOrderImage` L3818, `parseOcrText` L3863, `readOrderImage(s)` L3919/L4046

## ซื้อ
`renderPurchaseForm` L8389, `computeNeededQtyToday` L10619, `addPurchase` L10813, `renderPurchaseList` L11171,
เตือนกำไรหด `purchaseMarginCheck_` L12865, ราคาพุ่ง `computePriceSpikes_` L12905

## บิลสาขา / ค้างจ่าย / รีเช็ค / หนี้
`renderBillingList` L5366, จ่ายแล้ว `toggleBranchBillPaidQuick` L12703, รีเช็ค `writeBillingRecheckMark_` L7154,
ค้างจ่าย `renderOutstanding` L7705, หนี้ `loadDebts`/`renderDebts` L11516/L11548

## ล็อต / ตัดต้นทุน / เคลม
`loadRawLots` L8493, `drawPendingQty_` L8584 (= sellable − costed − claimed), `allocateClaimToDrawsFIFO_` L8640,
การ์ดตัด `computeLotSettleRows_` L8713 / `renderLotSettleCards_` L8775 / `confirmLotSettle_` L9012 (มี lock + rollback), ถังล็อต `lotTankStats_` L8619 + ปุ่มกดค้าง `wireLotHold_` L8937, จับคู่ยอดโอน `confirmSlipMatch_` L5271, จำผู้โอน↔สาขา `slipPayerHints_`/`rememberSlipPayer_` L5180 (คีย์ `slipPayers`, จดหลัง AY ยืนยันเท่านั้น แค่ติดป้าย), ร่างออเดอร์จาก LINE `loadLineOrderDrafts_` L3973 / `applyLineOrderDraft_` L4030 (คีย์ `lineOrders:วัน`, เติมฟอร์มผ่าน `fillOrderFormFromParsed_` ไม่บันทึก),
เคลม/ทิ้ง ใน `renderLeftover` (push wasteRecords ~L4583), ตรวจ `computeLotCostedQtyAudit_` L12463, `computeDayGaps_` L12330

## P&L / Brand fee
`computeMonthFinancialsCore_` L6455, `computeRangeFinancials` L6546, `renderMonthPL` L6630, แยกสินค้า `computePLBreakdown_` L6702,
รายปี `computeYearFinancials` L6767; Brand fee `isFeeExempt` L2444, `computeFee` L3242

## แดชบอร์ด / แจ้งเตือน
`renderDashboard` L13103, ศูนย์บัญชาการ `computeTodayCommand_` L12742, คาดการณ์ `computeOrderForecast_` L3664,
แจ้งเตือน `renderActivityFeed_` L3162 + `renderDataGaps` L12925

## สำรอง / ธีม / อัปเดต
`BACKUP_EXTRA_ROOT_KEYS` L8127, `BACKUP_PREFIXES` L8129, `exportAllData` L8130, `importAllData` L8175
`applyTheme_` L13467, `switchTab` L13299, `APP_BUILD` L13645, `checkForAppUpdate_` L13653
