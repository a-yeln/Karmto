const { launch, mkDay, openApp, makeChecker } = require('../helpers');

// แถบล่างมือถือ 4 ช่อง + ⚡ ค้นหา/สั่งงาน + ตารางสาขาแตะครั้งเดียว — ทั้งหมดเป็นการนำทาง ห้ามเขียนข้อมูลเอง
(async () => {
  const browser = await launch();
  const { check, finish } = makeChecker();
  const iso = '2026-11-12';
  const store = () => ({ rawLots: [], ['day:' + iso]: mkDay({ orders: { '01': { p1: 5 }, '03': { p2: 2 } } }) });
  const open = async (width, theme) => {
    const page = await openApp(browser, { store: store(), date: iso, viewport: { width, height: 844 } });
    await page.route(/fonts\./, r => r.abort());
    await page.clock.setFixedTime(new Date(iso + 'T10:00:00+07:00'));
    if (theme) await page.evaluate(t => { document.documentElement.setAttribute('data-theme', t); document.documentElement.setAttribute('data-tmode', 'full'); }, theme);
    return page;
  };

  for (const theme of ['', 'mermaid', 'sea', 'neon']) {
    const page = await open(420, theme);
    await page.click('#mNav [data-tab="order"]');
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => {
      const nav = document.getElementById('mNav').getBoundingClientRect();
      const top = document.elementFromPoint(nav.left + nav.width / 2, nav.top + nav.height / 2);
      return { panel: document.getElementById('panel-order').classList.contains('active'), active: document.querySelector('#mNav [data-tab="order"]').classList.contains('active'), onTop: !!top && !!top.closest('#mNav'), inView: nav.bottom <= innerHeight && nav.left >= 0 && nav.right <= innerWidth, cmdHidden: getComputedStyle(document.getElementById('cmdK')).display === 'none', overflow: document.documentElement.scrollWidth > innerWidth };
    });
    check(`${theme || 'macaron'} 420px: bottom bar switches to Orders, sits on top, nothing covers the page`, r.panel && r.active && r.onTop && r.inView && r.cmdHidden && !r.overflow, r);
    await page.close();
  }

  let page = await open(1100);
  check('Bottom bar is hidden on wide screens', await page.evaluate(() => getComputedStyle(document.getElementById('mNav')).display === 'none'));
  await page.keyboard.press('Control+k');
  check('Ctrl+K opens the command sheet with focus in the box', await page.evaluate(() => !document.getElementById('cmdK').hidden && document.activeElement.id === 'cmdKInput'));
  await page.keyboard.press('Escape');
  check('Escape closes it', await page.evaluate(() => document.getElementById('cmdK').hidden));
  await page.close();

  page = await open(420);
  await page.evaluate(async () => { await switchTab('order'); await new Promise(r => setTimeout(r, 500)); window.__writes.length = 0; });
  const grid = await page.evaluate(() => ({ n: document.querySelectorAll('#branchGrid .bg-chip').length, total: settings.branches.length, has: [...document.querySelectorAll('#branchGrid .bg-chip.has')].map(c => c.dataset.bgcode), count: document.getElementById('branchGridCount').textContent }));
  check('Branch grid shows every branch and marks the saved ones', grid.n === grid.total && grid.has.join() === '01,03' && grid.count.includes('2/' + grid.total), grid);
  await page.click('#branchGrid [data-bgcode="05"]');
  await page.waitForTimeout(300);
  const picked = await page.evaluate(() => ({ sel: document.getElementById('branchSelect').value, chip: document.querySelector('#branchGrid [data-bgcode="05"]').classList.contains('sel'), writes: window.__writes.length }));
  check('Tapping a branch opens its form and saves nothing', picked.sel === '05' && picked.chip && picked.writes === 0, picked);

  await page.click('#mNavBolt');
  await page.fill('#cmdKInput', 'บิล');
  const found = await page.evaluate(() => [...document.querySelectorAll('#cmdKList .cmdk-item span')].map(s => s.textContent));
  check('Typing "บิล" finds the Billing page', found.some(t => /Billing/.test(t)), found);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  check('Enter runs the first result and closes the sheet', await page.evaluate(() => document.getElementById('panel-billing').classList.contains('active') && document.getElementById('cmdK').hidden));

  await page.click('#mNavBolt');
  await page.fill('#cmdKInput', '03 เมือง');
  await page.click('#cmdKList .cmdk-item');
  await page.waitForTimeout(600);
  check('Searching a branch goes to Orders with that branch open', await page.evaluate(() => document.getElementById('panel-order').classList.contains('active') && document.getElementById('branchSelect').value === '03'));

  await page.click('#mNavBolt');
  await page.fill('#cmdKInput', '5/11');
  const dateItem = await page.evaluate(() => [...document.querySelectorAll('#cmdKList .cmdk-item span')].map(s => s.textContent));
  await page.click('#cmdKList .cmdk-item');
  await page.waitForTimeout(700);
  check('Typing 5/11 offers and jumps to 05/11 of the open year', dateItem.length === 1 && /05\/11\/2026/.test(dateItem[0]) && await page.evaluate(() => currentDate === '2026-11-05'), dateItem);

  await page.evaluate(async () => { await loadForDate('2026-11-12'); await switchTab('dashboard'); await new Promise(r => setTimeout(r, 800)); });
  await page.click('#wfJourney [data-wfstep="sup"]');
  await page.waitForTimeout(700);
  check('Checklist step "สั่งของ" opens the folded message card', await page.evaluate(() => document.getElementById('panel-order').classList.contains('active') && document.getElementById('msgCardBody').style.display !== 'none'));
  check('None of the navigation wrote order/cost data', await page.evaluate(() => window.__writes.filter(w => /^(day:|rawLots|settings)/.test(w.key)).length === 0));
  await finish(browser);
})();
