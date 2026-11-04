const { launch, mkDay, openApp, makeChecker } = require('../helpers');

// ฟอร์มจดสต๊อก — ซิงค์แบบปลอดภัย: ซิงค์เฉพาะวันที่ติ๊กครบต่อเนื่องจากวันแรก, แก้ทีละรายการ (ของอื่นไม่โดนทับ),
// รอบเบิกใหม่ "ไม่ตัดต้นทุนเอง", รอบเบิกที่ตัดต้นทุนแล้วไม่แก้ให้, ซิงค์ซ้ำไม่เพิ่มซ้ำ, ย้อนกลับได้, ปิดงวดได้เมื่อครบเท่านั้น
(async () => {
  const browser = await launch();
  const { check, finish } = makeChecker();
  const d1 = '2026-10-10', d2 = '2026-10-11';
  const store = {
    ['day:2026-10-09']: mkDay({ leftoverOut: { p1: 2 } }),
    ['day:' + d1]: mkDay({ orders: { '01': { p1: 5, p4: 3 } }, purchases: [
      { id: 'pu1', productId: 'p1', qty: 4, price: 180, seller: 'มนต์', paid: false },
      { id: 'pu9', productId: 'p2', qty: 2, price: 100, seller: 'มนต์', paid: false },
    ] }),
    ['day:' + d2]: mkDay({ orders: { '01': { p1: 3 } } }),
    rawLots: [{ id: 'L1', productId: 'p4', seller: 'ตลาด', buyDate: '2026-10-01', qtyTotal: 10, pricePerKg: 200, billId: 'L1', draws: [] }],
    lotProductBills: [{ id: 'lpL1', billId: 'L1', seller: 'ตลาด', buyDate: '2026-10-01', amount: 2000, productLabel: 'x', paid: true, paidDate: '2026-10-02' }],
  };
  const page = await openApp(browser, { store, date: d2, viewport: { width: 1024, height: 1200 } });
  await page.evaluate(async () => { localStorage.removeItem('karmto_stockform_draft'); await switchTab('stockform'); });
  await page.evaluate(([a, b]) => { document.getElementById('sfFromNew').value = a; document.getElementById('sfToNew').value = b; document.getElementById('sfStartBtn').click(); }, [d1, d2]);
  await page.waitForFunction(() => !!document.getElementById('sfStatus') && document.getElementById('sfStatus').textContent.length > 0, null, { timeout: 15000 });

  const clickSync = async () => {
    await page.evaluate(() => { document.getElementById('sfPreview').innerHTML = ''; document.getElementById('sfCheckBtn').click(); });
    await page.waitForFunction(() => { const t = document.getElementById('sfPreview').textContent; return t.length > 0 && !t.includes('กำลังตรวจ'); }, null, { timeout: 20000 });
    return page.evaluate(() => ({ text: document.getElementById('sfPreview').textContent, apply: !!document.getElementById('sfApplyBtn') }));
  };
  const apply = async () => {
    await page.evaluate(() => document.getElementById('sfApplyBtn').click());
    await page.waitForFunction(() => !!document.getElementById('sfStatus') && !document.getElementById('sfPreview').textContent.includes('กำลังซิงค์') && !document.querySelector('#sfPreview #sfApplyBtn'), null, { timeout: 20000 });
    await page.waitForTimeout(400);
  };

  // ยังไม่ติ๊กวันไหน → ไม่มีอะไรให้ซิงค์
  const r0 = await clickSync();
  check('Nothing syncs until a day is ticked as complete', !r0.apply && r0.text.includes('ยังไม่มีวันที่ติ๊ก'), r0.text.slice(0, 120));

  // วันแรก: แก้ซื้อสดกุ้ง 4→6, เบิกล็อต p4 3 กก. ได้ 3 — ติ๊กครบเฉพาะวันแรก (วันที่สองยังกรอกไม่ครบ)
  await page.evaluate(d => {
    sfCell(d, 'p1').fresh[0].qty = 6;
    sfCell(d, 'p4').draw = { kg: 3, yield: 3 };
    sfDraft.done = { [d]: true };
    sfDraft.days['2026-10-11'].p1.fresh.push({ lineId: 'zz', seller: 'มนต์', qty: 9, price: 1, yield: '' });
    sfRenderBody_();
  }, d1);
  const r1 = await clickSync();
  check('Preview lists only the ticked day, with a confirm button', r1.apply && r1.text.includes('1 วัน') && r1.text.includes('ยังไม่ตัดต้นทุน'), r1.text.slice(0, 200));
  // อีกเครื่องเพิ่มรายการซื้อของอีกสินค้าระหว่างนั้น — ต้องไม่หาย
  await page.evaluate(d => { window.__store['day:' + d].purchases.push({ id: 'other', productId: 'p3', qty: 1, price: 50, seller: 'ม๊ะก๊าด', paid: false }); }, d1);
  await apply();
  // ข้อมูลเปลี่ยนระหว่างดูตัวอย่าง → ต้องให้ดูใหม่ก่อน ไม่เขียนตามแผนเก่า
  const stale = await page.evaluate(() => document.getElementById('sfPreview').textContent);
  if (stale.includes('ข้อมูลในระบบเปลี่ยน')) await apply();

  const after = await page.evaluate(([a, b]) => {
    const day1 = window.__store['day:' + a], day2 = window.__store['day:' + b];
    const lot = window.__store.rawLots[0];
    return {
      pu1: day1.purchases.find(e => e.id === 'pu1').qty,
      keepOther: !!day1.purchases.find(e => e.id === 'other'), keepP2: !!day1.purchases.find(e => e.id === 'pu9'),
      settle: day1.purchases.filter(e => e.lotSettle || e.fromLot).length,
      draws: lot.draws.map(d => [d.date, d.qtyUsed, d.sellableQty, d.costedQty]),
      left1: day1.leftoverOut.p1, left4: day1.leftoverOut.p4,
      day2Untouched: day2.purchases.length === 0 && !day2.leftoverOut.p1,
      status: document.getElementById('sfStatus').textContent,
      bill: window.__store.lotProductBills[0].amount,
    };
  }, [d1, d2]);
  check('Changed purchase is patched in place; other purchases (incl. another device\'s) kept', after.pu1 === 6 && after.keepOther && after.keepP2, after);
  check('New draw starts NOT costed — no cost rows created by the sync', JSON.stringify(after.draws) === JSON.stringify([[d1, 3, 3, 0]]) && after.settle === 0, after);
  // ยกมา 2 + ซื้อ 6 − ส่ง 5 = 3 ; p4: 3 − 3 = 0
  check('Leftover written for the synced day only; unfinished day untouched', after.left1 === 3 && !after.left4 && after.day2Untouched, after);
  check('Period stays open: 1/2 days synced', after.status.includes('ยังไม่ปิด') && after.status.includes('ซิงค์แล้ว 1/2'), after.status);
  check('Paid lot bill is not touched', after.bill === 2000, after.bill);
  check('Close-period button is disabled while incomplete', await page.evaluate(() => document.getElementById('sfCloseBtn').disabled));

  // ซิงค์ซ้ำโดยไม่ได้แก้อะไร → ไม่มีอะไรต้องเขียน
  const r2 = await clickSync();
  check('Re-sync with no edits writes nothing (no duplicates)', !r2.apply && r2.text.includes('ซิงค์ไปหมดแล้ว'), r2.text.slice(0, 120));

  // รอบเบิกที่ตัดต้นทุนไปแล้ว → เปลี่ยนเลขในฟอร์ม ระบบต้องไม่แก้ให้เอง
  await page.evaluate(d => { window.__store.rawLots[0].draws[0].costedQty = 3; sfCell(d, 'p4').draw = { kg: 4, yield: 4 }; sfRenderBody_(); }, d1);
  const r3 = await clickSync();
  check('A costed draw is never rewritten by the sync', !r3.apply && r3.text.includes('ตัดต้นทุนหรือมีเคลมไปแล้ว'), r3.text.slice(0, 160));
  await page.evaluate(d => { window.__store.rawLots[0].draws[0].costedQty = 0; sfCell(d, 'p4').draw = { kg: 3, yield: 3 }; sfRenderBody_(); }, d1);

  // ย้อนกลับการซิงค์ล่าสุด
  await page.evaluate(() => { window.confirm = () => true; });
  await page.evaluate(async () => { await sfUndo_(); });
  await page.waitForTimeout(500);
  const und = await page.evaluate(a => { const day1 = window.__store['day:' + a]; return { pu1: day1.purchases.find(e => e.id === 'pu1').qty, other: !!day1.purchases.find(e => e.id === 'other'), draws: window.__store.rawLots[0].draws.length, left1: day1.leftoverOut.p1, status: document.getElementById('sfStatus').textContent }; }, d1);
  check('Undo restores the previous values and keeps others\' edits', und.pu1 === 4 && und.other && und.draws === 0 && und.left1 === undefined && und.status.includes('ซิงค์แล้ว 0/2'), und);

  // กรอกครบทั้งสองวันแล้วซิงค์ → ปิดงวดได้
  await page.evaluate(([a, b]) => { sfDraft.done = { [a]: true, [b]: true }; sfDraft.days[b].p1.fresh = [{ lineId: 'n2', seller: 'มนต์', qty: 2, price: 185, yield: '', extra: 0, note: '', paid: false }]; sfRenderBody_(); sfRenderStatus_(); }, [d1, d2]);
  const r4 = await clickSync();
  check('Both ticked days sync together', r4.apply && r4.text.includes('2 วัน'), r4.text.slice(0, 120));
  await apply();
  const fin = await page.evaluate(b => ({ status: document.getElementById('sfStatus').textContent, closeOff: document.getElementById('sfCloseBtn').disabled, d2: window.__store['day:' + b].purchases.map(e => e.id) }), d2);
  check('All days synced → period can be closed', fin.status.includes('ปิดงวดได้') && !fin.closeOff && fin.d2.includes('n2'), fin);
  await page.evaluate(async () => { await sfClosePeriod_(); });
  await page.waitForTimeout(300);
  check('Closing the period clears the draft for a new one', await page.evaluate(() => !!document.getElementById('sfStartBtn')));

  await finish(browser);
})();
