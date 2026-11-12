const { launch, mkDay, openApp, makeChecker } = require('../helpers');

// แถบอายุค้างรับบนศูนย์บัญชาการ + กราฟขั้นบันไดกำไรใน P&L — แสดงอย่างเดียว ตัวเลขต้องตรงกับยอดเดิมของแอป
(async () => {
  const browser = await launch();
  const { check, finish } = makeChecker();
  const T = '2026-11-12';
  const store = {
    rawLots: [],
    ['day:' + T]: mkDay({ orders: { '01': { p1: 2 } } }),                                   // ค้าง 0 วัน
    ['day:2026-11-07']: mkDay({ orders: { '02': { p1: 1 } } }),                             // ค้าง 5 วัน
    ['day:2026-11-01']: mkDay({ orders: { '03': { p1: 3 }, '04': { p1: 1 } }, billingPaid: { '04': true } }), // ค้าง 11 วัน (สาขา 04 โอนแล้ว ไม่นับ)
  };
  const page = await openApp(browser, { store, date: T, viewport: { width: 420, height: 1000 } });
  await page.route(/fonts\./, r => r.abort());
  await page.clock.setFixedTime(new Date(T + 'T10:00:00+07:00'));
  await page.evaluate(async () => { window.__writes.length = 0; await switchTab('dashboard'); await new Promise(r => setTimeout(r, 900)); });

  const a = await page.evaluate(async () => {
    const c = await computeTodayCommand_();
    const bill = (iso, code) => branchBillAmount(window.__store['day:' + iso].orders[code], iso);
    const el = document.querySelector('#cmdCenter .age-wrap');
    return { buckets: c.ageBuckets, total: c.unpaidTotal, want: [bill('2026-11-12', '01'), bill('2026-11-07', '02'), bill('2026-11-01', '03')], shown: !!el, legend: el ? el.querySelector('.age-legend').textContent : '', segs: el ? el.querySelectorAll('.age-bar i').length : 0, overflow: document.documentElement.scrollWidth > innerWidth };
  });
  check('Aging buckets = unpaid bills by days outstanding (0–2 / 3–7 / >7), paid bills excluded', JSON.stringify(a.buckets) === JSON.stringify(a.want) && a.want.every(v => v > 0), a);
  check('Buckets add up to the "ค้างรับทั้งหมด" total', Math.abs(a.buckets.reduce((s, v) => s + v, 0) - a.total) < 0.001, a);
  check('Aging bar is drawn with 3 segments and a legend, no sideways scroll', a.shown && a.segs === 3 && a.legend.includes('เกิน 7 วัน') && !a.overflow, a);
  const edge = await page.evaluate(async () => {
    const out = {};
    for (const [n, iso] of [[2, '2026-11-10'], [3, '2026-11-09'], [7, '2026-11-05'], [8, '2026-11-04']]) {
      Object.keys(window.__store).filter(k => k.startsWith('day:')).forEach(k => delete window.__store[k]);
      window.__store['day:' + iso] = { orders: { '01': { p1: 1 } } };
      Object.keys(dayCache_).forEach(k => delete dayCache_[k]); try { localStorage.clear(); } catch (e) {}
      if (window.storage.__clearListCache) window.storage.__clearListCache();
      out[n] = (await computeTodayCommand_()).ageBuckets.findIndex(v => v > 0);
    }
    return out;
  });
  check('Day boundaries: 2 days → first bucket, 3 and 7 → second, 8 → third', edge[2] === 0 && edge[3] === 1 && edge[7] === 1 && edge[8] === 2, edge);
  await page.screenshot({ path: process.env.SHOT || '/dev/null' }).catch(() => {});
  await page.evaluate(async () => { await renderTodayCommand_(); });
  await page.click('#cmdCenter .age-wrap');
  await page.waitForTimeout(500);
  check('Tapping the aging bar opens Billing', await page.evaluate(() => document.getElementById('panel-billing').classList.contains('active')));

  const w = await page.evaluate(async () => {
    await switchTab('dashboard'); await new Promise(r => setTimeout(r, 400));
    document.getElementById('plMonthInput').value = '2026-11'; await renderMonthPL();
    const r = await computeMonthFinancials('2026-11');
    const vals = [...document.querySelectorAll('#plSummary .wfall-val')].map(v => v.textContent);
    const lbls = [...document.querySelectorAll('#plSummary .wfall-lbl')].map(v => v.textContent);
    return { vals, lbls, want: [money(r.revenue), '-' + money(r.cogsTotal), '-' + money(r.expenseTotal), '-' + money(r.feeTotal), '-' + money(r.wasteTotal), money(r.netProfit)], sums: Math.abs(r.revenue - r.cogsTotal - r.expenseTotal - r.feeTotal - r.wasteTotal - r.netProfit) < 0.001, overflow: document.documentElement.scrollWidth > innerWidth };
  });
  check('Waterfall shows revenue → 4 deductions → net profit with the same numbers as the P&L table', JSON.stringify(w.vals) === JSON.stringify(w.want) && w.lbls.length === 6 && w.lbls[5] === 'กำไรสุทธิ', w);
  check('The steps really add up to net profit, and fit a phone', w.sums && !w.overflow, w);

  const loss = await page.evaluate(() => { const h = buildProfitWaterfall_({ revenue: 100, cogsTotal: 150, expenseTotal: 10, feeTotal: 5, wasteTotal: 0 }); const d = document.createElement('div'); d.innerHTML = h; return { loss: !!d.querySelector('i.loss'), zero: d.querySelectorAll('u').length, text: [...d.querySelectorAll('.wfall-val')].pop().textContent }; });
  check('A loss month draws a red bar below a zero line', loss.loss && loss.zero > 0 && loss.text.includes('65'), loss);
  check('Empty month draws nothing', await page.evaluate(() => buildProfitWaterfall_({ revenue: 0, cogsTotal: 0, expenseTotal: 0, feeTotal: 0, wasteTotal: 0 }) === '' && buildReceivableAging_([0, 0, 0]) === ''));
  check('Nothing was written', await page.evaluate(() => window.__writes.filter(x => !/^(dayRevs|actlog:)/.test(x.key)).length === 0));
  await finish(browser);
})();
