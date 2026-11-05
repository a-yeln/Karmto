const { launch, openApp, makeChecker } = require('../helpers');

// ตัวแยกข้อความจากภาพออเดอร์ — ใช้ข้อความที่ OCR อ่านได้จริงจากภาพออเดอร์ (มีคำเพี้ยน/รหัส Bm9 เพี้ยน) ต้องได้สาขา+จำนวนครบ
(async () => {
  const browser = await launch();
  const { check, finish } = makeChecker();
  const page = await openApp(browser, { store: {}, date: '2026-11-05', viewport: { width: 600, height: 600 } });
  const r = await page.evaluate(() => {
    const pr = t => { const x = parseOcrText(t); const row = {}; x.items.forEach(it => { const p = matchProductFromOcrName(it.name); if (p) row[p] = it.qty; }); return { code: x.branchCode, area: x.branchArea, row, un: x.unmatched.length }; };
    return {
      a: pr(`ซ๊” สาขา 1 ประชาอุทิศ
8ทาร กุ้งแช่ (กก.)                       2 กก.
ธ8ทา9 กุ้งดอง (กก.)                      2 กก.
ธิทา9 คุ้งตัดหัว (กก.)                    8 กก.
ธิทท9 ปูจิด (คค.)                         1กก.
ธ8ทา9 หมึกคล้วย (กก.)                    1กก.
ธ8ทา9 หอยเซอรี่ (กก.)                    1กก.
ธิทา9 หอยนางรม (กระปุก)                  10 กระปุก`),
      b: pr(`ซั ธง หลักสี่
ธิทา9 กุ้งตัดหัว (กก.)                    1 กก.
Bm หอยนาจรม (กระปุก)                     3กระปก`),
      c: pr(`= สาขา 4 คลอง3ธัญบุรี
Bm9 กุ้งตัดหัว (กก.)                      12an.
8ทา9 หมึกกล้วย (nn)
1กก.
Bm9 หอยนางรม (กระปุก)`),
    };
  });
  check('All 7 rows + branch from a messy OCR read', r.a.code === '1' && JSON.stringify(r.a.row) === JSON.stringify({ p1: 2, p2: 2, p3: 8, p4: 1, p5: 1, p6: 1, p7: 10 }), r.a);
  check('"ธง" branch, misread นางรม still recognised by its jar unit', r.b.code === '00' && r.b.area === 'หลักสี่' && r.b.row.p3 === 1 && r.b.row.p7 === 3, r.b);
  check('Never takes the "9" of a garbled Bm9 as a quantity; qty on the next line is used', r.c.row.p3 === 12 && r.c.row.p5 === 1 && r.c.row.p7 === undefined && r.c.un === 1, r.c);
  await finish(browser);
})();
