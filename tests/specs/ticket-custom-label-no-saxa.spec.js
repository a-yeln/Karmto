const { launch, mkDay, openApp, makeChecker } = require('../helpers');

// ป้าย PeriPage: สาขาที่ตั้งป้ายชื่อกำหนดเอง (เช่น ลูกค้า KT) ไม่ขึ้นคำว่า "สาขา" นำหน้า — สาขาปกติยังขึ้นเหมือนเดิม
(async () => {
  const browser = await launch();
  const { check, finish } = makeChecker();
  const page = await openApp(browser, { store: { 'day:2026-11-07': mkDay({}) }, date: '2026-11-07', viewport: { width: 420, height: 900 } });
  const r = await page.evaluate(() => {
    settings.branches.push({ code: 'KT', area: '', label: 'คุณสมชาย' });
    const custom = buildOrderTicketHTML('KT', '2026-11-07', { p1: 2 }, 'x1');
    const normal = buildOrderTicketHTML(settings.branches.find(b => b.code !== '00' && !b.label).code, '2026-11-07', { p1: 2 }, 'x2');
    return { custom: custom.includes('orderticket-saxa'), customName: custom.includes('คุณสมชาย'), normal: normal.includes('orderticket-saxa') };
  });
  check('Custom-labelled branch ticket has no "สาขา" kicker', !r.custom && r.customName, r);
  check('Normal branch ticket still shows "สาขา"', r.normal, r);
  await finish(browser);
})();
