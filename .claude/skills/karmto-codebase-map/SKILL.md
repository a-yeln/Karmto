---
name: karmto-codebase-map
description: แผนที่ฟังก์ชันหลักใน index.html ของ Karmto แยกตามหน้า (storage, ออเดอร์, ซื้อ, บิล, ล็อต, P&L, แดชบอร์ด, สำรอง, ธีม) — ใช้ก่อนออกแบบ/แก้/รีวิวโค้ด เพื่อหาของเดิมมาใช้ซ้ำ
---
# แผนที่ index.html (บรรทัดโดยประมาณ ±5, ณ 2026-11-07 — ยืนยันด้วย Grep ก่อนอ้างเสมอ)

## Storage
- `window.storage` get/set/delete/list/patchField/patchOps ~L42-100 → Apps Script (`SHEET_API_URL` L24, `apiKey_()` L27)
- day cache ใน localStorage ~L2437-2453, `pushDayRev_` L2456; ล็อกเดือน `isMonthClosed_`/`monthLockBlocks_` ~L2485-2520
- ออฟไลน์คิว `queueOfflineWrite_` L2589, `flushOfflineQueue_` L2608; `wrapStorageForDayRevs_` L2637
- `loadDay` L2712, `loadDaysBulk` L2736, `saveDay` L2767, `emptyDay` L2249
- เขียนเฉพาะจุด: `writeBillingPaid_` L2779, `writeDayArrayOp_` L2849, `writeDayFieldPath_` L2860, `writeRootArrayOp_` L2870

## ออเดอร์
`renderOrderList` L3119, `saveRow` L3170, ตั๋วออเดอร์ `buildOrderTicketHTML` L3214, `renderMessages` L3775
OCR รูปออเดอร์ (Tesseract): `getOcrWorker_` L3523, `parseOrderImage` L3556, `parseOcrText` L3601, `readOrderImage(s)` L3657/L3698

## ซื้อ
`renderPurchaseForm` L7445, `computeNeededQtyToday` L9475, `addPurchase` L9669, `renderPurchaseList` L10027,
เตือนกำไรหด `purchaseMarginCheck_` L11690, ราคาพุ่ง `computePriceSpikes_` L11730

## บิลสาขา / ค้างจ่าย / รีเช็ค / หนี้
`renderBillingList` L4612, จ่ายแล้ว `toggleBranchBillPaidQuick` L11559, รีเช็ค `writeBillingRecheckMark_` L6210,
ค้างจ่าย `renderOutstanding` L6761, หนี้ `loadDebts`/`renderDebts` L10372/L10404

## ล็อต / ตัดต้นทุน / เคลม
`loadRawLots` L7549, `drawPendingQty_` L7640 (= sellable − costed − claimed), `allocateClaimToDrawsFIFO_` L7675,
การ์ดตัด `computeLotSettleRows_` L7743 / `renderLotSettleCards_` L7783 / `confirmLotSettle_` L7868 (มี lock + rollback),
เคลม/ทิ้ง ใน `renderLeftover` (push wasteRecords ~L4233), ตรวจ `computeLotCostedQtyAudit_` L11319, `computeDayGaps_` L11186

## P&L / Brand fee
`computeMonthFinancialsCore_` L5512, `computeRangeFinancials` L5603, `renderMonthPL` L5687, แยกสินค้า `computePLBreakdown_` L5758,
รายปี `computeYearFinancials` L5823; Brand fee `isFeeExempt` L2258, `computeFee` L2981

## แดชบอร์ด / แจ้งเตือน
`renderDashboard` L11928, ศูนย์บัญชาการ `computeTodayCommand_` L11598, คาดการณ์ `computeOrderForecast_` L3402,
แจ้งเตือน `renderActivityFeed_` L2942 + `renderDataGaps` L11750

## สำรอง / ธีม / อัปเดต
`BACKUP_EXTRA_ROOT_KEYS` L7183, `BACKUP_PREFIXES` L7185, `exportAllData` L7186, `importAllData` L7231
`applyTheme_` L12191, `switchTab` L12023, `APP_BUILD` L12369, `checkForAppUpdate_` L12377
