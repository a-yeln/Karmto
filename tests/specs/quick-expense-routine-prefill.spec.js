const { launch, mkDay, openApp, makeChecker } = require('../helpers');

(async () => {
  const browser = await launch();
  const { check, finish } = makeChecker();
  const today = await (async () => { const p = await browser.newPage(); await p.goto('about:blank'); const t = await p.evaluate(()=>{ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }); await p.close(); return t; })();

  const page = await openApp(browser, { date: today, store: { ['day:'+today]: mkDay({ orders: { '01': { p1: 5 } } }) } });
  const phat = await page.evaluate(() => settings.purchaseSellers.find(s=>s.includes('พี่พัฒน์')));
  check('settings has a พี่พัฒน์ payee to route the routine to', !!phat, phat);

  const readForm = () => page.evaluate(() => ({
    cat: document.getElementById('dashExpCategory').value,
    payee: document.getElementById('dashExpPayee').value,
    amt: document.getElementById('dashExpAmount').value,
    note: document.getElementById('dashExpNote').value,
  }));

  // ===== 1) ยังไม่มีค่าแรงวันนี้ -> เปิดปุ่มเพิ่มรายจ่ายด่วน ต้องเติมค่าแรง 700 ให้ =====
  await page.click('#dwhAddExpenseBtn');
  await page.waitForTimeout(300);
  let f = await readForm();
  console.log('Open #1:', JSON.stringify(f));
  check('First open: category pre-filled to ค่าแรง', f.cat === 'ค่าแรง', f);
  check('First open: payee pre-filled to พี่พัฒน์', f.payee === phat, f);
  check('First open: amount pre-filled to 700', f.amt === '700', f);

  // บันทึกค่าแรงจริงผ่านปุ่มใน modal
  await page.click('#dashExpenseModalSave');
  await page.waitForTimeout(500);
  const wageSaved = await page.evaluate((iso) => (window.__store['day:'+iso].expenses||[]).some(e=>e.category==='ค่าแรง' && Number(e.amount)===700), today);
  check('Wage 700 actually saved for today', wageSaved);

  // ===== 2) มีค่าแรงแล้ว -> เปิดอีกครั้ง ต้องเติมน้ำแข็งให้ และกรอกจำนวนถุงแล้ว ×40 อัตโนมัติ =====
  await page.click('#dwhAddExpenseBtn');
  await page.waitForTimeout(300);
  f = await readForm();
  console.log('Open #2:', JSON.stringify(f));
  check('Second open: category pre-filled to น้ำแข็ง', f.cat === 'น้ำแข็ง', f);
  check('Second open: payee pre-filled to พี่พัฒน์', f.payee === phat, f);
  check('Second open: amount left blank for ice (computed from bag count)', f.amt === '', f);
  await page.fill('#dashExpNote', '6');
  await page.waitForTimeout(100);
  f = await readForm();
  check('Typing 6 bags fills amount with 6×40 = 240', f.amt === '240', f);

  await finish(browser);
})();
