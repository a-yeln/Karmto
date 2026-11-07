---
name: karmto-money-review
description: สูตรเงินของ Karmto (P&L, ต้นทุนต่อหน่วย, Brand fee, หอยนางรม กก.↔กระปุก) และเช็คลิสต์ตรวจ diff ที่แตะเงิน — ใช้ตอนรีวิว PR หรือคำนวณตัวเลขบัญชี
---
# ตรวจเงิน Karmto

## สูตรอ้างอิง (หาโค้ดจริงก่อนสรุปทุกครั้ง)
- P&L เดือน: `computeMonthFinancialsCore_` (~L5512), ช่วงวัน/กรองสาขา `computeRangeFinancials` (~L5603), แยกสินค้า `computePLBreakdown_`
- ต้นทุนล็อต: `lotCostTotal`, `lotCostPerKg`, `drawCostPerUnit_` (~L7613-7640) — ต้นทุนเข้า P&L เฉพาะส่วนที่ AY กดตัดแล้ว (`costedQty`)
- Brand fee: `computeFee` (~L2981), สาขาที่ยกเว้น `isFeeExempt` (branch.separate)
- หอยนางรม p7: ซื้อเป็น กก. ขายเป็นกระปุก — ระวังหน่วยปนกัน

## เช็คลิสต์ diff (ตอบ ผ่าน/ไม่ผ่าน/ไม่เกี่ยว + file:line)
1. ไม่มีการตั้ง `costedQty` > 0 โดยไม่ผ่านปุ่ม ✅ ตัด
2. ทุกการเขียนเป็น patch
3. ไม่แก้/ลบของที่จ่าย/ตัด/เคลมแล้วแบบเงียบ
4. เคารพ `closedMonths`
5. คีย์ใหม่อยู่ใน backup ทั้งสองที่
6. สูตรถูก — คิดเลขตัวอย่างจริง 1 เคสประกอบ (รวมปัดเศษ)
7. ไม่มี secret ในโค้ด
สรุป **ผ่าน** / **ไม่ผ่าน (ห้าม merge)**
