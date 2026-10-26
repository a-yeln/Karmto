const { launch, openApp, makeChecker } = require('../helpers');

// ปุ่ม ◂/▸ ย่อ/ขยายเมนูข้างต้องใช้ได้จริงทุกขนาดจอที่มันโผล่ — เดิมช่วงแท็บเล็ต (768–1023px) ปุ่มโผล่แต่กดแล้วไม่กาง
(async () => {
  const browser = await launch();
  const { check, finish } = makeChecker();
  const state = page => page.evaluate(() => {
    const b = document.getElementById('dwNavCollapseBtn');
    const r = b.getBoundingClientRect();
    return { btnVisible: getComputedStyle(b).display !== 'none' && r.width > 0,
             navW: Math.round(document.querySelector('.dash-wide-nav').getBoundingClientRect().width),
             label: getComputedStyle(document.querySelector('.dash-wide-nav .dwn-lbl')).display };
  });
  const click = page => page.evaluate(() => document.getElementById('dwNavCollapseBtn').click());

  for (const w of [1280, 900]) {
    const page = await openApp(browser, { viewport: { width: w, height: 900 } });
    const a = await state(page); await click(page); await page.waitForTimeout(150);
    const b = await state(page); await click(page); await page.waitForTimeout(150);
    const c = await state(page);
    console.log(w, JSON.stringify({a, b, c}));
    check(`${w}px: button visible`, a.btnVisible, a);
    check(`${w}px: first press changes the nav width`, a.navW !== b.navW, {a: a.navW, b: b.navW});
    check(`${w}px: second press restores it`, c.navW === a.navW, {a: a.navW, c: c.navW});
    check(`${w}px: wide state shows menu labels, narrow hides them`, (Math.max(a.navW,b.navW) === a.navW ? a.label : b.label) !== 'none' && (Math.min(a.navW,b.navW) === a.navW ? a.label : b.label) === 'none', {a, b});
    await page.close();
  }
  const m = await openApp(browser, { viewport: { width: 420, height: 900 } });
  const ms = await state(m);
  check('mobile (420px): collapse button hidden (drawer uses ☰ instead)', !ms.btnVisible, ms);
  check('mobile (420px): drawer still shows menu labels', ms.label !== 'none', ms);
  await finish(browser);
})();
