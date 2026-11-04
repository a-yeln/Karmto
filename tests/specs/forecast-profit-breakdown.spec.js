const { launch, mkDay, openApp, makeChecker } = require('../helpers');

// คาดการณ์ยอดสั่ง (เฉลี่ยวันเดียวกัน 4 สัปดาห์), กำไรแยกสินค้า/สาขาใน P&L, และเตือนราคาซื้อพุ่งใน Notifications
(async () => {
  const browser = await launch();
  const { check, finish } = makeChecker();
  const T = '2026-10-29'; // พฤหัส
  const store = {
    ['day:2026-10-22']: mkDay({ orders: { '01': { p1: 10 }, '02': { p1: 6 } } }),
    ['day:2026-10-15']: mkDay({ orders: { '01': { p1: 8 } } }),
    ['day:2026-10-08']: mkDay({ orders: {} }), // ปิดร้าน ไม่นับ
    ['day:2026-10-01']: mkDay({ orders: { '01': { p1: 12 } } }),
    ['day:2026-10-28']: mkDay({ leftoverOut: { p1: 3 } }),
    ['day:' + T]: mkDay({ orders: { '01': { p1: 5 } }, purchases: [{ id: 'hi', productId: 'p2', qty: 1, price: 150, seller: 'มนต์' }] }),
    ['day:2026-10-05']: mkDay({ purchases: [{ id: 'a', productId: 'p1', qty: 20, price: 100, seller: 'มนต์' }, { id: 'b2', productId: 'p2', qty: 1, price: 100 }] }),
    ['day:2026-10-06']: mkDay({ purchases: [{ id: 'b3', productId: 'p2', qty: 1, price: 100 }] }),
    ['day:2026-10-07']: mkDay({ purchases: [{ id: 'b4', productId: 'p2', qty: 1, price: 100 }] }),
  };
  const page = await openApp(browser, { store, date: T, viewport: { width: 1024, height: 1200 } });
  await page.clock.setFixedTime(new Date(T + 'T10:00:00+07:00'));

  const f = await page.evaluate(async () => { const r = await computeOrderForecast_(currentDate); await switchTab('order'); await renderOrderForecast_(); return { used: r.used.length, avg: r.avg.p1, br: r.branches, text: document.getElementById('forecastBody').textContent }; });
  // (16 + 8 + 12) / 3 = 12 ; ของเหลือยกมา 3 → ควรซื้อ 9
  check('Forecast averages the same weekday over 4 weeks, skipping closed days', f.used === 3 && f.avg === 12 && f.br === 1.3, f);
  check('Forecast card shows suggested buy = forecast − leftover', f.text.includes('12') && f.text.includes('9'), f.text.slice(0, 200));

  const b = await page.evaluate(async () => { const r = await computePLBreakdown_('2026-10'); return { p1: r.prod.p1, br: r.branches.map(x => [x.code, Math.round(x.rev), Math.round(x.gross)]), price: priceOnDate('p1', '2026-10-01') }; });
  // p1 ขาย 10+6+8+12+5 = 41 หน่วย, ต้นทุน 2000 → ต้นทุนเฉลี่ย 2000/41
  const exp = 41 * b.price;
  check('Product breakdown: revenue from bills, cost from that product\'s purchases', b.p1.qty === 41 && Math.round(b.p1.rev) === Math.round(exp) && b.p1.cost === 2000, b);
  const s01 = b.br.find(x => x[0] === '01');
  check('Branch breakdown: bill total and estimated gross by avg unit cost', s01 && s01[1] === Math.round(35 * b.price) && s01[2] === Math.round(35 * b.price - 35 * 2000 / 41), b.br);

  const n = await page.evaluate(async () => { const a = await computePriceSpikes_(); await switchTab('noti'); await renderDataGaps(); return { a, list: document.getElementById('dataGapsList').textContent, badge: document.getElementById('notiBadge').textContent }; });
  check('Price spike (+50% vs 30-day average) is flagged in Notifications', n.a.length === 1 && n.a[0].pct === 50 && n.list.includes('สูงกว่าปกติ +50%'), n.a);

  await finish(browser);
})();
