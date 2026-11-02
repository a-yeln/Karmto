const { launch, mkDay, openApp, makeChecker } = require('../helpers');

// เมนู Noti (รายการล่าสุด + แจ้งเตือนข้อมูลไม่ครบ), ปุ่มเพิ่มรายจ่ายอยู่แถวเดียวกับหัวข้อบนมือถือ,
// การ์ดในกลุ่มเดียวกันสีไม่ซ้ำ, สรุปกำไรรายเดือน 4 การ์ดบาลานซ์, เหลือรับเข้าเป็นกล่องรูป
(async () => {
  const browser = await launch();
  const { check, finish } = makeChecker();
  const today = '2026-10-20';
  const prev = '2026-10-19';
  const store = {
    ['day:' + prev]: mkDay({ orders: { '01': { p1: 3 } }, leftoverOut: { p1: 1.5, p3: 4 } }),
    ['day:' + today]: mkDay({ orders: { '01': { p1: 3 } } }),
    activityLog: [{ id: 'a1', ts: Date.now(), text: 'ทดสอบรายการล่าสุด' }],
  };
  const page = await openApp(browser, { store, date: today, viewport: { width: 400, height: 880 } });
  await page.evaluate(async d => { await loadForDate(d); }, today);

  const head = await page.evaluate(() => {
    const r = id => document.getElementById(id).getBoundingClientRect();
    return { btn: r('dwhAddExpenseBtn').top, title: r('dwhTitle').top, nav: document.querySelector('.dwh-datenav').getBoundingClientRect().top };
  });
  check('Mobile: add-expense button sits on the title row, date bar below', Math.abs(head.btn - head.title) < 30 && head.nav > head.btn + 20, head);

  const navOrder = await page.evaluate(() => [...document.querySelectorAll('.dash-wide-nav [data-tab]')].map(b => b.getAttribute('data-tab')));
  check('Noti menu sits right before Settings', navOrder.indexOf('noti') === navOrder.indexOf('settings') - 1, navOrder);
  check('Activity feed and data-gaps card live in the Noti panel', await page.evaluate(() =>
    !!document.querySelector('#panel-noti #dashActivityFeed') && !!document.querySelector('#panel-noti #dataGapsCard') && !document.querySelector('#panel-dashboard #dashActivityFeed')));
  await page.evaluate(async () => { await switchTab('noti'); });
  check('Noti shows the activity log', await page.evaluate(() => document.getElementById('dashActivityFeed').textContent.includes('ทดสอบรายการล่าสุด')));

  await page.evaluate(async () => { await switchTab('dashboard'); });
  await page.waitForTimeout(600);
  const tones = await page.evaluate(() => [...document.querySelectorAll('.dash-wide-bento .dwtile[data-tone]')].map(t => getComputedStyle(t).backgroundColor));
  check('Dashboard tiles each have a different color', tones.length >= 8 && new Set(tones).size === tones.length, tones);
  const pl = await page.evaluate(() => {
    const ms = [...document.querySelectorAll('#plSummary .dash-grid.g4 .dash-metric')];
    return { n: ms.length, colors: new Set(ms.map(m => getComputedStyle(m).backgroundColor)).size, cols: getComputedStyle(document.querySelector('#plSummary .dash-grid.g4')).gridTemplateColumns.split(' ').length };
  });
  check('Monthly P&L: 4 distinct-color cards in a balanced 2x2 on phone', pl.n === 4 && pl.colors === 4 && pl.cols === 2, pl);

  await page.evaluate(async () => { await switchTab('leftover'); });
  const tiles = await page.evaluate(() => [...document.querySelectorAll('#leftoverInView .ltile')].map(t => ({ name: t.querySelector('.ltile-name').textContent, qty: t.querySelector('.ltile-qty').textContent.trim(), cam: !!t.querySelector('[data-ltimg]') })));
  check('Leftover-in shows one picture tile per product with name + qty inside', tiles.length === 7 && tiles.every(t => t.cam), tiles);
  check('Tile quantities come from yesterday\'s leftover', tiles[0].qty.startsWith('1.5') && tiles.find(t => t.name === 'กุ้งตัดปาก').qty.startsWith('4'), tiles);

  // อัปโหลดรูป: เก็บแยกคีย์ต่อสินค้า และกล่องแสดงรูปแทนอิโมจิ
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 800; c.height = 600;
    const g = c.getContext('2d'); g.fillStyle = '#e88'; g.fillRect(0, 0, 800, 600);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    await setProductImage_('p1', new File([blob], 'x.png', { type: 'image/png' }));
  });
  const img = await page.evaluate(() => ({ stored: typeof window.__store['productImage:p1'] === 'string' && window.__store['productImage:p1'].startsWith('data:image/jpeg'), size: (window.__store['productImage:p1'] || '').length, shown: !!document.querySelector('#leftoverInView .ltile.has-img img') }));
  check('Uploaded photo is saved small under its own key and shown in the tile', img.stored && img.size <= 45000 && img.shown, img);

  await finish(browser);
})();
