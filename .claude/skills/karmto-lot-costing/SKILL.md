---
name: karmto-lot-costing
description: โครงข้อมูลล็อตและรอบเบิกของ Karmto กับวิธีตรวจการตัดต้นทุนย้อนหลัง (costedQty/claimedQty) เพื่อทำรายการให้ AY กด ✅ ตัด เอง — ใช้ตอนตรวจข้อมูลล็อตหรือแก้โค้ดส่วนล็อต
---
# ล็อตและการตัดต้นทุน

## โครง
- `rawLots[]`: ล็อตซื้อ + `draws[]` แต่ละรอบเบิก `{qtyUsed, sellableQty, costedQty, claimedQty, ...}` + `lotSettleAllocations`
- `lotProductBills` / `lotTransportBills`: บิลค่าสินค้า/ค่าขนส่งของล็อต
- `wasteRecords[]`: reason `'waste'|'claim'`, `lotClaimAllocations` (แบ่งด้วย `allocateClaimToDrawsFIFO_` เก่าไปใหม่)
- ค้างตัด = `drawPendingQty_` = sellableQty − costedQty − claimedQty

## ตรวจย้อนหลัง (อ่านอย่างเดียว)
1. รอบที่ค้างตัด > 0 นานเกินควร → "ควรกด ✅ ตัด" + จำนวน + วันที่/ล็อต/สินค้า
2. costedQty + claimedQty > sellableQty → ⚠️ ตัดเกิน
3. เคลมรวมเกินที่เบิก, รอบเบิกซ้ำวันเดียวกัน, ต้นทุนรวมล็อต ≠ บิล → ⚠️
4. เรียงเก่าไปใหม่ ให้ AY หาในแอปเจอทันที (หน้าล็อต → การ์ดตัดต้นทุน)

**ห้ามเขียนข้อมูล ห้ามตัดเอง** — ส่งรายการให้ AY กดเท่านั้น
