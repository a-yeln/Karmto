# ขอให้บอท LINE ในกลุ่มส่งสำเนารูปมาที่ระบบ Karmto

เอกสารสำหรับฝ่ายไอทีของบริษัทที่ดูแลบัญชีทางการ (บอท) ในกลุ่ม LINE สาขา

## ทำไมต้องขอ
- LINE ให้ 1 กลุ่มมีบัญชีทางการได้ 1 บัญชี กลุ่มนี้มีบอทของท่านอยู่แล้ว บอทของร้านก้ามโตจึงเข้ากลุ่มไม่ได้
- ร้านก้ามโต (ผู้ส่งอาหารทะเล) ต้องอ่านรูป 2 แบบที่สาขาส่งในกลุ่ม: สลิปโอนเงิน (ใช้กระทบยอดกับบิล) และรูปออเดอร์ (ใช้ร่างออเดอร์)
- ไม่ต้องเพิ่มบอทใหม่ในกลุ่ม ไม่ต้องให้รหัสหรือกุญแจของบอทท่านกับเรา ขอแค่ให้เซิร์ฟเวอร์ webhook ของท่านส่งสำเนา "รูปภาพ" ของกลุ่มนี้ต่อมาที่ลิงก์ของเรา

## สิ่งที่ขอให้ทำ (เพิ่มใน webhook handler ของท่าน)
เมื่อได้ event `message` ชนิด `image` จากกลุ่มนี้ (`source.groupId` ของกลุ่มสาขา):
1. ดึงไฟล์รูปด้วย token ของท่านตามปกติ: `GET https://api-data.line.me/v2/bot/message/{messageId}/content`
2. ส่งต่อมาที่ลิงก์ของ Karmto (เจ้าของร้านจะส่งลิงก์เต็มให้ทางช่องทางส่วนตัว — ลิงก์มีรหัสลับ ห้ามเผยแพร่):

```
POST https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec?a=intake&t=<SECRET>
Content-Type: text/plain; charset=utf-8      (หรือ application/json)

{"image":"<base64 ของไฟล์รูป JPEG หรือ PNG>","sender":"<ชื่อที่แสดงของผู้ส่งในกลุ่ม ไม่บังคับ>","sentAt":"<เวลาส่ง ไม่บังคับ>"}
```

- ปลายทางเป็น Google Apps Script: จะตอบ `302` ไปยัง `script.googleusercontent.com` ให้ตาม redirect ด้วย `GET` (ค่าเริ่มต้นของ HTTP client ส่วนใหญ่) หรือจะไม่อ่านคำตอบก็ได้
- คำตอบ: `{"ok":true,"id":"H…"}` รับแล้ว · `{"ok":true,"dup":true}` รูปนี้เคยส่งแล้ว · `{"ok":false,"error":"…"}` ไม่รับ
  (`not_image` ไม่ใช่ JPEG/PNG · `too_big` เกิน 5 MB · `daily_limit` เกิน 1,500 รูปต่อวัน)
- ส่งทีละรูปต่อ 1 คำขอ ไม่ต้องส่งข้อความตัวอักษร สติกเกอร์ วิดีโอ หรือไฟล์อื่น
- ถ้าส่งไม่สำเร็จ (เน็ต/5xx) ลองใหม่ได้ ระบบกันรูปซ้ำด้วย hash ของไฟล์

ตัวอย่าง (Node.js 18+):

```js
async function relayToKarmto(messageId, displayName, timestamp) {
  const img = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
    headers: { Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` },
  });
  if (!img.ok) return;
  const image = Buffer.from(await img.arrayBuffer()).toString('base64');
  await fetch(process.env.KARMTO_INTAKE_URL, {          // เก็บลิงก์ใน env/secret ไม่ใส่ในโค้ด
    method: 'POST',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body: JSON.stringify({ image, sender: displayName || '', sentAt: new Date(timestamp).toISOString() }),
  });
}
```

## ข้อมูลที่เราเก็บและไม่เก็บ
- รูปถูกอ่านเป็นข้อความ (OCR) แล้วลบไฟล์ถาวรทันที ไม่เก็บรูป
- สลิป: เก็บยอด วันที่ เวลา ชื่อผู้โอน/ผู้รับ ธนาคาร เลขอ้างอิง (เลขยาวถูกปิดเหลือ 4 ตัวท้าย)
- รูปออเดอร์: เก็บข้อความรายการสินค้า/จำนวนเป็นร่าง
- รูปอื่น (บิล รูปทั่วไป): ไม่เก็บอะไร
- ระบบไม่ตอบ ไม่ส่งข้อความเข้ากลุ่ม และไม่เรียก LINE API ของท่าน
- ยกเลิกได้ทุกเมื่อ: ท่านเลิกส่ง หรือเจ้าของร้านเปลี่ยนรหัสลับ ลิงก์เดิมจะใช้ไม่ได้ทันที
