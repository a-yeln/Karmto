const { launch, mkDay, openApp, makeChecker } = require('../helpers');

// งบกำไร-ขาดทุน (และกำไรแยกสินค้า/สาขา) บนมือถือต้องไม่ดันหน้าจอให้กว้างเกินจอ — เคยล้นขวาเพราะกริด 1fr + ชื่อแถวยาวที่ห้ามตัดบรรทัด
(async () => {
  const browser = await launch();
  const { check, finish } = makeChecker();
  const T = '2026-11-07';
  const store = { rawLots: [] };
  for (let d = 1; d <= 7; d++) {
    const iso = '2026-11-0' + d;
    store['day:' + iso] = mkDay({ orders: { '01': { p1: 5, p2: 2, p3: 8, p4: 1, p5: 1, p6: 1, p7: 10 }, '12': { p3: 13, p7: 17 }, '30': { p3: 10, p7: 40 } },
      purchases: [{ id: 'a' + d, productId: 'p1', qty: 5, price: 180, seller: 'มนต์' }, { id: 'b' + d, productId: 'p3', qty: 31, price: 200, seller: 'ม๊ะก๊าด' }],
      expenses: [{ id: 'e' + d, category: 'ค่าน้ำแข็ง', amount: 470 }] });
  }
  for (const w of [360, 412]) {
    const page = await openApp(browser, { store, date: T, viewport: { width: w, height: 900 } });
    await page.clock.setFixedTime(new Date(T + 'T10:00:00+07:00'));
    const r = await page.evaluate(async () => {
      await switchTab('dashboard');
      document.getElementById('plMonthInput').value = '2026-11';
      await renderMonthPL();
      await new Promise(res => setTimeout(res, 800));
      return { sw: document.documentElement.scrollWidth, iw: window.innerWidth, hasBreakdown: !!document.querySelector('#plByProduct table') };
    });
    check(`P&L fits a ${w}px phone screen (no sideways overflow)`, r.sw <= r.iw && r.hasBreakdown, r);
    await page.close();
  }
  await finish(browser);
})();
