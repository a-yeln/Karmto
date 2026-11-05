const { launch, mkDay, openApp, makeChecker } = require('../helpers');

// บันทึก/เพิ่มในบิลแล้ว ช่องสินค้าเลื่อนไปตัวถัดไปของร้านเดียวกัน (มนต์: แช่→ดอง→ปู→หมึก→นางรม ข้ามกุ้งตัด/เชอรี่), ปิดได้
(async () => {
  const browser = await launch();
  const { check, finish } = makeChecker();
  const iso = '2026-10-20';
  const page = await openApp(browser, { store: { ['day:' + iso]: mkDay({ orders: { '01': { p1: 5, p2: 3 } } }) }, date: iso, viewport: { width: 420, height: 1000 } });
  await page.evaluate(async () => { localStorage.removeItem('karmto.purchAutoNext'); window.confirm = () => true; await switchTab('purchase'); });
  const fill = (q, pr) => page.evaluate(([q, pr]) => { document.getElementById('purchQty').value = q; document.getElementById('purchPrice').value = pr; }, [q, pr]);
  const sel = () => page.evaluate(() => document.getElementById('purchProduct').value);
  await page.evaluate(() => { const s = document.getElementById('purchProduct'); s.value = 'p1'; s.onchange(); });

  const seq = [];
  await fill(5, 180); await page.evaluate(() => addPurchToStage()); seq.push(await sel());        // แช่ → ดอง
  await fill(3, 190); await page.evaluate(() => addPurchToStage()); seq.push(await sel());        // ดอง → ปู (ข้ามกุ้งตัด)
  await fill(2, 150); await page.evaluate(async () => { await addPurchase(); }); seq.push(await sel()); // บันทึกบิล ปู → หมึก
  await fill(1, 140); await page.evaluate(async () => { await addPurchase(); }); seq.push(await sel()); // หมึก → นางรม (ข้ามเชอรี่)
  check('Advances within the same shop, skipping other shops\' products', JSON.stringify(seq) === '["p2","p4","p5","p7"]', seq);
  const saved = await page.evaluate(i => window.__store['day:' + i].purchases.map(e => [e.productId, e.qty]), iso);
  check('Each row was saved under the product it was typed for', JSON.stringify(saved) === '[["p1",5],["p2",3],["p4",2],["p5",1]]', saved);
  check('Seller stays the same after advancing', await page.evaluate(() => document.getElementById('purchSeller').selectedIndex >= 0));

  await page.waitForTimeout(1800);
  check('Shows which product it moved to', (await page.evaluate(() => document.getElementById('toast').textContent)).includes('เนื้อหอยนางรม'));

  // ปิดสวิตช์ → ไม่เลื่อน
  await page.evaluate(() => { const t = document.getElementById('purchAutoNext'); t.checked = false; t.dispatchEvent(new Event('change')); });
  await fill(4, 27); await page.evaluate(() => addPurchToStage());
  check('Switch off: product stays as chosen', await sel() === 'p7');
  await finish(browser);
})();
