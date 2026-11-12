const { launch, mkDay, openApp, makeChecker } = require('../helpers');

// หัวจอแน่น + ปุ่ม KARMTO ไม่ตกบรรทัดในหน้าบิล + ป้าย "✓ บันทึกแล้ว" เด้งเมื่อเขียนสำเร็จจริง
(async () => {
  const browser = await launch();
  const { check, finish } = makeChecker();
  const iso = '2026-11-12';
  const store = () => ({ rawLots: [], ['day:' + iso]: mkDay({ orders: { '01': { p1: 5 } } }) });
  const measure = async (theme, width) => {
    const page = await openApp(browser, { store: store(), date: iso, viewport: { width, height: 844 } });
    await page.route(/fonts\./, r => r.abort());
    const r = await page.evaluate(async theme => {
      if (theme) { document.documentElement.setAttribute('data-theme', theme); document.documentElement.setAttribute('data-tmode', 'full'); }
      await switchTab('billing'); await new Promise(r => setTimeout(r, 500));
      const box = id => document.getElementById(id).getBoundingClientRect();
      const chip = box('dwhTodayBtn'), title = box('dwhTitle');
      return { sameRow: chip.top < title.bottom && chip.bottom > title.top, h: Math.round(document.getElementById('dwhStickyWrap').getBoundingClientRect().height), overflow: document.documentElement.scrollWidth > window.innerWidth };
    }, theme);
    await page.close();
    return r;
  };
  for (const theme of ['', 'mermaid', 'sea', 'neon']) {
    for (const width of [420, 768, 900]) {
      const r = await measure(theme, width);
      const maxH = width < 768 ? (theme === 'mermaid' ? 175 : theme === 'sea' ? 165 : 130) : (theme === 'sea' ? 130 : 90);
      check(`${theme || 'macaron'} ${width}px: KARMTO chip on the title row, header ≤ ${maxH}px, no sideways scroll`, r.sameRow && r.h <= maxH && !r.overflow, r);
    }
  }

  const page = await openApp(browser, { store: store(), date: iso, viewport: { width: 420, height: 900 } });
  await page.route(/fonts\./, r => r.abort());
  await page.evaluate(async () => { await switchTab('settings'); await new Promise(r => setTimeout(r, 400)); });
  check('No "saved" badge before anything is saved', await page.evaluate(() => !document.querySelector('.save-pop')));
  await page.evaluate(() => { const b = document.getElementById('saveBillInfoBtn'); let c = b.parentElement; while (c && !b.getBoundingClientRect().height) { const t = c.querySelector('[data-collapse-toggle], .collapse-toggle, .card-toggle'); if (t) t.click(); c = c.parentElement; } });
  await page.evaluate(() => { const b = document.getElementById('saveShelfLifeBtn'); b.scrollIntoView({ block: 'center' }); b.click(); });
  await page.waitForSelector('.save-pop', { timeout: 4000 }).catch(() => {});
  const pop = await page.evaluate(() => { const p = document.querySelector('.save-pop'), b = document.getElementById('saveShelfLifeBtn').getBoundingClientRect(); if (!p) return null; const r = p.getBoundingClientRect(); return { text: p.textContent, near: !b.height || (Math.abs((r.left + r.width / 2) - (b.left + b.width / 2)) < 80 && Math.abs(r.top - b.top) < 80), inView: r.left >= 0 && r.right <= innerWidth }; });
  check('Saving a settings form pops "✓ บันทึกแล้ว" on screen', !!pop && pop.text.includes('บันทึกแล้ว') && pop.near && pop.inView, pop);
  await page.screenshot({ path: process.env.SHOT || '/dev/null' }).catch(() => {});
  await page.waitForTimeout(1900);
  check('The badge removes itself', await page.evaluate(() => !document.querySelector('.save-pop')));

  // เขียนไม่สำเร็จ = ไม่เด้ง
  await page.evaluate(() => { const raw = Object.getPrototypeOf(window.storage); raw.patchField = async () => { throw new Error('boom'); }; document.getElementById('saveShelfLifeBtn').click(); });
  await page.waitForTimeout(900);
  check('A failed save shows no "saved" badge', await page.evaluate(() => !document.querySelector('.save-pop')));
  // เข้าคิวออฟไลน์ = ยังไม่ขึ้นเซิร์ฟเวอร์ = ไม่เด้ง
  const p2 = await openApp(browser, { store: store(), date: iso, viewport: { width: 420, height: 900 } });
  await p2.route(/fonts\./, r => r.abort());
  await p2.evaluate(async () => { await switchTab('settings'); await new Promise(r => setTimeout(r, 400)); window.__forceOffline = true; document.getElementById('saveShelfLifeBtn').click(); });
  await p2.waitForTimeout(900);
  check('A save queued while offline shows no "saved" badge', await p2.evaluate(() => !document.querySelector('.save-pop')));
  await finish(browser);
})();
