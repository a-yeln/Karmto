const { launch, mkDay, openApp, makeChecker } = require('../helpers');

// รายจ่ายกิจการ: หมวดค่าสินค้า = หลายรายการ (ชื่อ/จำนวน/ราคา/ค่าเพิ่มเติม) + ค่าส่ง (ขนส่งระบุ/ราคา/หมายเหตุ)
// จำนวนเงินรวมคำนวณให้ และหมวดค่าส่ง/ลาล่า ต้องระบุขนส่ง
(async () => {
  const browser = await launch();
  const { check, finish } = makeChecker();
  const iso = '2026-10-20';
  const page = await openApp(browser, { store: { ['day:' + iso]: mkDay({}) }, date: iso, viewport: { width: 420, height: 1000 } });
  await page.evaluate(async () => { window.confirm = () => true; await switchTab('purchase'); });
  // ให้หมวด "ค่าสินค้า" มีในรายการ (ปกติมาจากการตั้งค่าหมวดรายจ่ายของร้าน)
  await page.evaluate(() => { const s = document.getElementById('expCategory'); if(![...s.options].some(o => o.value === 'ค่าสินค้า')) s.add(new Option('ค่าสินค้า', 'ค่าสินค้า')); });

  const setCat = (v) => page.evaluate(v => { const s = document.getElementById('expCategory'); s.value = v; s.dispatchEvent(new Event('change')); }, v);
  await setCat('ค่าสินค้า');
  const shown = await page.evaluate(() => getComputedStyle(document.getElementById('expGoodsBox')).display !== 'none');
  check('ค่าสินค้า shows the multi-item box', shown);

  await page.evaluate(() => { const r = document.querySelector('[data-goodsrow="0"]'); });
  const typeRow = (i, f, v) => page.evaluate(([i, f, v]) => { const inp = document.querySelector(`[data-goodsrow="${i}"] [data-gf="${f}"]`); inp.value = v; inp.dispatchEvent(new Event('input', { bubbles: true })); }, [i, f, v]);
  await typeRow(0, 'name', 'กุ้งตัด'); await typeRow(0, 'qty', '4.8'); await typeRow(0, 'price', '290');
  await page.evaluate(() => document.getElementById('expGoodsAddRow').click());
  await typeRow(1, 'name', 'น้ำแข็ง'); await typeRow(1, 'qty', '2'); await typeRow(1, 'price', '50'); await typeRow(1, 'extra', '10');
  const amt1 = await page.evaluate(() => Number(document.getElementById('expAmount').value));
  check('Amount = sum of items incl. extra (4.8×290 + 2×50+10)', Math.abs(amt1 - (4.8*290 + 110)) < 0.01, amt1);

  await page.evaluate(() => { const t = document.getElementById('expShipToggle'); t.checked = true; t.dispatchEvent(new Event('change')); });
  await page.evaluate(() => { document.getElementById('expShipCarrier').value = 'Kerry'; document.getElementById('expShipPrice').value = '80'; document.getElementById('expShipPrice').dispatchEvent(new Event('input')); document.getElementById('expShipNote').value = 'แช่แข็ง'; });
  const amt2 = await page.evaluate(() => Number(document.getElementById('expAmount').value));
  check('Shipping price is added to the total', Math.abs(amt2 - (4.8*290 + 110 + 80)) < 0.01, amt2);

  await page.evaluate(() => document.getElementById('addExpenseBtn').click());
  await page.waitForTimeout(600);
  const rec = await page.evaluate(i => (window.__store['day:' + i].expenses || []).slice(-1)[0], iso);
  check('Saved record keeps items and shipping', rec && rec.category === 'ค่าสินค้า' && rec.items.length === 2 && rec.items[1].extra === 10 && rec.shipping.carrier === 'Kerry' && rec.shipping.price === 80 && rec.shipping.note === 'แช่แข็ง', rec);
  check('Saved amount matches the total', rec && Math.abs(rec.amount - (4.8*290 + 110 + 80)) < 0.01, rec && rec.amount);
  const cleared = await page.evaluate(() => document.querySelectorAll('[data-goodsrow]').length === 1);
  check('Goods form resets after saving', cleared);

  // ค่าส่ง/ลาล่า: ต้องระบุขนส่ง
  await setCat('ค่าส่ง/ลาล่า');
  const tShown = await page.evaluate(() => getComputedStyle(document.getElementById('expTransportBox')).display !== 'none');
  check('ค่าส่ง/ลาล่า shows the carrier field', tShown);
  await page.evaluate(() => { document.getElementById('expAmount').value = '150'; document.getElementById('addExpenseBtn').click(); });
  await page.waitForTimeout(400);
  const noneSaved = await page.evaluate(i => (window.__store['day:' + i].expenses || []).length, iso);
  check('Transport without carrier is blocked', noneSaved === 1, noneSaved);
  await page.evaluate(() => { document.getElementById('expTransportCarrier').value = 'Lalamove'; document.getElementById('addExpenseBtn').click(); });
  await page.waitForTimeout(600);
  const tRec = await page.evaluate(i => (window.__store['day:' + i].expenses || []).slice(-1)[0], iso);
  check('Transport saves the carrier name', tRec && tRec.carrier === 'Lalamove' && tRec.amount === 150, tRec);

  await page.screenshot({ path: 'screenshots/expense-goods-420.png', fullPage: false });
  await finish(browser);
})().catch(e => { console.error(e); process.exit(1); });
