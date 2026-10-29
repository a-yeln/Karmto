const { launch, mkDay, openApp, makeChecker } = require('../helpers');

// ภาพเคลื่อนไหวตอนเปิดแอป/สลับแท็บ: ใส่คลาสช่วงสั้นๆ แล้วถอดเอง, แท่งกราฟใช้คีย์เฟรมเด้งขึ้นลง, ปิดได้ในตั้งค่า,
// ไม่เล่นเองตอนรันเทสต์ (webdriver) เพื่อไม่ให้การวัดขนาดในเทสต์อื่นเพี้ยน
(async () => {
  const browser = await launch();
  const { check, finish } = makeChecker();
  const store = { 'day:2026-10-27': mkDay({ orders: { '01': { p1: 5 } } }), 'day:2026-10-28': mkDay({ orders: { '01': { p1: 8 }, '02': { p1: 3 } } }) };
  const page = await openApp(browser, { store, date: '2026-10-28', viewport: { width: 1280, height: 900 } });

  check('Does not auto-play under automated tests (webdriver)', await page.evaluate(() => !document.body.classList.contains('motion-intro')));

  await page.evaluate(async () => { await switchTab('dashboard'); });
  await page.waitForSelector('.tbar', { timeout: 8000 });
  await page.evaluate(() => { playIntroMotion_({ force: true, first: true }); });
  const st = await page.evaluate(() => {
    const bar = document.querySelector('.tbar');
    const card = document.querySelector('.panel.active .card, .panel.active .dwtile');
    return {
      on: document.body.classList.contains('motion-intro'),
      bar: bar ? getComputedStyle(bar).animationName : null,
      card: card ? getComputedStyle(card).animationName : null,
    };
  });
  check('Forced intro adds the motion class', st.on, st);
  check('Trend bars use the bounce keyframes (kmBarY)', st.bar === 'kmBarY', st);
  check('Cards rise in (kmRise)', st.card === 'kmRise', st);

  await page.waitForTimeout(4300);
  const after = await page.evaluate(() => ({ on: document.body.classList.contains('motion-intro'), bar: getComputedStyle(document.querySelector('.tbar')).animationName }));
  check('Motion class removed after the window, everything at rest', !after.on && after.bar === 'none', after);

  await page.evaluate(async () => { await switchTab('settings'); });
  await page.evaluate(() => { const h = document.getElementById('motionToggle').closest('.card').querySelector('h3'); if (!document.getElementById('motionToggle').offsetParent) h.click(); });
  await page.waitForTimeout(200);
  const tog = await page.evaluate(() => document.getElementById('motionToggle').checked);
  check('Settings toggle defaults to on', tog === true, tog);
  await page.click('#motionToggle');
  const off = await page.evaluate(() => ({ stored: localStorage.getItem('karmto.motion'), enabled: motionEnabled_() }));
  check('Turning it off is remembered on this device', off.stored === '0' && off.enabled === false, off);
  await page.evaluate(() => { localStorage.removeItem('karmto.motion'); });

  await finish(browser);
})();
