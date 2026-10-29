const { launch, makeChecker } = require('../helpers');

// หน้าเปิดแอป: ไม่โชว์ตอนรันเทสต์ (webdriver) เว้นแต่กด "ดูตัวอย่าง" (preview flag), หายเองภายใน ~2.8 วิ,
// แตะเพื่อข้ามได้, โหมดวันละครั้งจดวันที่ไว้, ตัวเลือกในตั้งค่าเก็บค่าในเครื่อง
(async () => {
  const browser = await launch();
  const { check, finish } = makeChecker();
  const BASE = (process.env.BASE_URL || 'http://localhost:8765') + '/index.html';
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  check('No splash under automated tests by default', await page.evaluate(() => !document.getElementById('splash')));

  await page.evaluate(() => { localStorage.setItem('karmto.splashPreview', '1'); localStorage.setItem('karmto.splash', 'off'); });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  const first = await page.evaluate(() => {
    const el = document.getElementById('splash');
    return { shown: !!el, letters: el ? el.querySelectorAll('.sp-word span').length : 0, flagCleared: localStorage.getItem('karmto.splashPreview') === null,
      date: localStorage.getItem('karmto.splashDate'), today: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date()) };
  });
  check('Preview shows the splash even when the mode is off', first.shown && first.letters === 6, first);
  check('Preview flag is one-shot', first.flagCleared, first);
  check('Shown date recorded (Bangkok)', first.date === first.today, first);
  await page.waitForTimeout(3000);
  check('Splash removes itself after the intro', await page.evaluate(() => !document.getElementById('splash') && window.__splashActive === false));

  await page.evaluate(() => localStorage.setItem('karmto.splashPreview', '1'));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
  await page.click('#splash');
  await page.waitForTimeout(650);
  check('Tap skips the splash immediately', await page.evaluate(() => !document.getElementById('splash')));

  await page.evaluate(async () => { await new Promise(r => setTimeout(r, 1500)); });
  const opts = await page.evaluate(() => [...document.querySelectorAll('#splashModeSelect option')].map(o => o.value));
  check('Settings offers daily / always / off', JSON.stringify(opts) === JSON.stringify(['daily', 'always', 'off']), opts);
  await page.evaluate(() => { const s = document.getElementById('splashModeSelect'); s.value = 'always'; s.dispatchEvent(new Event('change')); });
  check('Choice is stored on this device', await page.evaluate(() => localStorage.getItem('karmto.splash') === 'always'));
  await page.evaluate(() => { localStorage.removeItem('karmto.splash'); localStorage.removeItem('karmto.splashDate'); });

  await finish(browser);
})();
