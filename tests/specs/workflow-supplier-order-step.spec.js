const { launch, mkDay, openApp, makeChecker } = require('../helpers');

// เช็คลิสต์วันนี้ ขั้นที่ 2 = "สั่งของ" (แทนป้าย PeriPage) — ติ๊กเมื่อคัดลอกข้อความสั่งม๊ะก๊าด หรือคัดลอกทั้งหมด
(async () => {
  const browser = await launch();
  const { check, finish } = makeChecker();
  const iso = '2026-11-12';
  const store = () => ({ ['day:' + iso]: mkDay({ orders: { '01': { p1: 5, p3: 2 } } }) });
  const stepState = page => page.evaluate(async () => {
    await new Promise(r => setTimeout(r, 400));
    await switchTab('dashboard'); await new Promise(r => setTimeout(r, 800));
    const el = document.querySelector('#wfJourney .wf-step[data-wfstep="sup"]');
    return { n: document.querySelectorAll('#wfJourney .wf-step').length, lbl: el && el.querySelector('.wf-lbl').textContent, done: !!el && el.classList.contains('done'), sub: el && el.querySelector('.wf-sub').textContent };
  });
  const open = async () => {
    const page = await openApp(browser, { store: store(), date: iso, viewport: { width: 420, height: 900 } });
    await page.route(/fonts\./, r => r.abort());
    await page.clock.setFixedTime(new Date(iso + 'T10:00:00+07:00'));
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    await page.evaluate(async () => { await switchTab('order'); await new Promise(r => setTimeout(r, 500)); window.__writes.length = 0; });
    return page;
  };
  const IDX = { mahkard: 1, monk: 2 };
  const copyIdx = (page, tag) => page.evaluate(i => document.querySelector('#messagesArea [data-copy="' + i + '"]').click(), IDX[tag]);

  let page = await open();
  let s = await stepState(page);
  check('Step 2 is "สั่งของ", still 7 steps, not ticked before copying', s.n === 7 && s.lbl === 'สั่งของ' && !s.done, s);
  await page.evaluate(async () => { await switchTab('order'); await new Promise(r => setTimeout(r, 500)); });
  await copyIdx(page, 'monk');
  s = await stepState(page);
  check('Copying another supplier message does not tick it', !s.done, s);
  await page.evaluate(async () => { await switchTab('order'); await new Promise(r => setTimeout(r, 500)); });
  await copyIdx(page, 'mahkard');
  s = await stepState(page);
  check('Copying the ม๊ะก๊าด message ticks it and shows the time', s.done && /คัดลอกแล้ว \d\d:\d\d/.test(s.sub), s);
  const w = await page.evaluate(iso => ({ day: window.__store['day:' + iso], writes: window.__writes.filter(x => x.key === 'day:' + iso) }), iso);
  check('Only workflow.supplierMsgAt is written — orders untouched, no whole-day set', !!w.day.workflow.supplierMsgAt && JSON.stringify(w.day.orders) === JSON.stringify({ '01': { p1: 5, p3: 2 } }) && w.writes.length >= 1 && w.writes.every(x => x.op !== 'set'), w.writes);
  await page.screenshot({ path: process.env.SHOT || '/dev/null' }).catch(() => {});
  await page.close();

  page = await open();
  await page.evaluate(() => document.getElementById('copyAllMsgBtn').click());
  s = await stepState(page);
  check('"คัดลอกทั้งหมด" also ticks it', s.done, s);
  await finish(browser);
})();
