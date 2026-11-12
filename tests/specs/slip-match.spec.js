const path = require('path');
const fs = require('fs');
const { launch, mkDay, openApp, makeChecker, stripBanner } = require('../helpers');

// การ์ด "จับคู่ยอดโอน" (#slipMatchCard ในแท็บบิล): AY พิมพ์ยอดจากสลิป → ระบบแค่เสนอบิลค้างโอนที่ยอดตรง
// กฎเหล็ก: ระบบไม่ติ๊กจ่ายเอง — พิมพ์/เลือก/ยกเลิก ต้องไม่มีการเขียน; ยืนยัน = patchField เดียวที่ day:<iso> ['billingPaid', code]
// ยอดบิลในเทสใช้รายการ custom (qty 1 × ราคา) เพื่อไม่ผูกกับราคาสินค้า — สูตรยอดบิลยังเป็นของแอป (branchBillAmount + billExtra)
const TODAY = '2026-11-12';
const SHOT_DIR = process.env.SHOT_DIR || path.join(__dirname, '..', 'screenshots');
const bill = amt => ({ custom: [{ name: 'ของ', qty: 1, price: amt }] });

function seedStore(){
  return {
    ['day:' + TODAY]: mkDay({ orders: { '01': bill(1250), '09': bill(1200) } }),
    ['day:2026-11-10']: mkDay({
      orders: { '01': bill(1250), '02': bill(1200), '03': bill(1250), '04': bill(1234.5), '05': bill(1300), '06': bill(1349), '11': bill(1351), '08': { p4: 0 }, '10': bill(1350) },
      billExtra: { '02': 50 },
      billingPaid: { '03': { paid: true, paidDate: '2026-11-10', transferAmount: 1250, billedAmount: 1250 } },
    }),
    ['day:2026-11-08']: mkDay({ orders: { '02': bill(1250) } }),
  };
}

(async () => {
  const browser = await launch();
  const { check, finish } = makeChecker();

  async function open(store){
    const page = await openApp(browser, { store, date: TODAY });
    await page.clock.setFixedTime(new Date(TODAY + 'T10:00:00+07:00'));
    await page.evaluate(async () => {
      window.__toasts = [];
      const orig = window.showToast;
      window.showToast = m => { window.__toasts.push(String(m)); return orig(m); };
      await loadClosedMonths_();
      await switchTab('billing');
    });
    await stripBanner(page);
    return page;
  }
  const reset = page => page.evaluate(() => { window.__writes = []; window.__toasts = []; });
  const type = async (page, v) => { await page.fill('#slipMatchAmount', String(v)); await page.waitForTimeout(600); };
  const sel = (iso, code) => `[data-slipiso="${iso}"][data-slipcode="${code}"]`;
  const pickBill = async (page, iso, code) => { await page.click(sel(iso, code)); await page.waitForTimeout(250); };
  const view = page => page.evaluate(() => {
    const box = document.getElementById('slipMatchResults');
    const q = s => box.querySelector(s);
    const btns = Array.from(box.querySelectorAll('button.slip-match')).map(b => ({ iso: b.dataset.slipiso, code: b.dataset.slipcode, kind: b.dataset.slipkind, best: b.classList.contains('best'), picked: b.classList.contains('picked'), text: b.textContent.replace(/\s+/g, ' ').trim() }));
    const c = q('[data-slipconfirm]');
    return {
      btns, exact: btns.filter(b => b.kind === 'exact').map(b => b.iso + '/' + b.code), near: btns.filter(b => b.kind === 'near').map(b => b.iso + '/' + b.code),
      panel: q('[data-slippanel]') ? q('[data-slippanel]').textContent.replace(/\s+/g, ' ').trim() : null,
      confirm: c ? { disabled: c.disabled } : null, cancel: !!q('[data-slipcancel]'),
      closed: !!q('[data-slipclosed]'), offline: !!q('[data-slipoffline]'), empty: !!q('[data-slipempty]'), bad: !!q('[data-slipbad]'),
      nearMsg: q('[data-slipnearmsg]') ? q('[data-slipnearmsg]').textContent : null, note: q('[data-slipnote]') ? q('[data-slipnote]').textContent : null,
      paidDate: q('#slipMatchPaidDate') ? q('#slipMatchPaidDate').value : null,
      warn: q('#slipMatchDateWarn') && getComputedStyle(q('#slipMatchDateWarn')).display !== 'none' ? q('#slipMatchDateWarn').textContent : '',
      input: document.getElementById('slipMatchAmount').value,
    };
  });
  const writes = page => page.evaluate(() => window.__writes.map(w => ({ op: w.op, key: w.key, path: w.path })));
  const dayWrites = ws => ws.filter(w => String(w.key).startsWith('day:'));
  const paidOf = (page, iso, code) => page.evaluate(([iso, code]) => (window.__store['day:' + iso].billingPaid || {})[code], [iso, code]);
  const toasts = page => page.evaluate(() => window.__toasts.slice());
  const waitIdle = page => page.waitForFunction(() => !slipMatchBusy_, null, { timeout: 15000 });

  let page = await open(seedStore());
  const codesOk = await page.evaluate(() => ['01', '02', '03', '04', '05', '06', '08', '09', '10', '11'].filter(c => !branchByCode(c)));
  check('เตรียมข้อมูล: รหัสสาขาที่ใช้ในเทสมีอยู่จริงในแอป', codesOk.length === 0, codesOk);
  const storeBefore = await page.evaluate(() => JSON.stringify(window.__store));
  await reset(page);

  // ============ A) ฟังก์ชันคำนวณ (อ่านอย่างเดียว) ============
  const calc = await page.evaluate(async () => {
    const m = await computeSlipMatches_(1250);
    const cands = await loadSlipCandidates_(true);
    return {
      exact: m.exact.map(x => x.iso + '/' + x.code + '=' + x.amt), near: m.near.map(x => x.iso + '/' + x.code + ':' + x.diff),
      cands: cands.map(c => c.iso + '/' + c.code).sort(),
      zero: await computeSlipMatches_(0),
      edge101: (await computeSlipMatches_(1452)).near.map(x => x.code + ':' + x.diff), edge100: (await computeSlipMatches_(1451)).near.map(x => x.code + ':' + x.diff),
      parse: [parseSlipAmount_('1,250'), parseSlipAmount_('฿1234.50'), parseSlipAmount_('12.345'), parseSlipAmount_('abc'), parseSlipAmount_('0'), parseSlipAmount_(''), parseSlipAmount_('-5'), parseSlipAmount_('1e3')],
      money: [slipMoney_(1234.5), slipMoney_(1250), slipMoney_(0)],
    };
  });
  check('ยอดตรงเป๊ะขึ้นก่อน เรียงวันที่ใหม่→เก่า (12/11 → 10/11 → 08/11)', JSON.stringify(calc.exact) === JSON.stringify(['2026-11-12/01=1250', '2026-11-10/01=1250', '2026-11-10/02=1250', '2026-11-08/02=1250']), calc.exact);
  check('billExtra รวมในยอดบิล (10/11 สาขา 02: 1200 + 50 = 1250 ตรงเป๊ะ)', calc.exact.includes('2026-11-10/02=1250'), calc.exact);
  check('ใกล้เคียง: เรียงตามส่วนต่างน้อย→มาก พร้อมทิศทาง (+ = บิลมากกว่า); ต่าง ฿100 พอดีขึ้น ต่าง ฿101 (สาขา 11) ไม่ขึ้น',
    JSON.stringify(calc.near) === JSON.stringify(['2026-11-10/04:-15.5', '2026-11-12/09:-50', '2026-11-10/05:50', '2026-11-10/06:99', '2026-11-10/10:100']), calc.near);
  check('บิลจ่ายแล้ว (สาขา 03) และบิลยอด 0 (สาขา 08) ไม่อยู่ในรายการให้เลือก', !calc.cands.includes('2026-11-10/03') && !calc.cands.includes('2026-11-10/08') && calc.cands.length === 10, calc.cands);
  check('ขอบ ฿100 (ไม่ถูกบังด้วยการตัด 5 รายการ): โอน 1452 → บิล 1351 ต่าง ฿101 ไม่ขึ้นเลย; โอน 1451 → ต่าง ฿100 พอดีขึ้น (บิลน้อยกว่า)', calc.edge101.length === 0 && JSON.stringify(calc.edge100) === '["11:-100"]', { edge101: calc.edge101, edge100: calc.edge100 });
  check('ยอด 0 → ไม่เสนอบิลใดเลย', calc.zero.exact.length === 0 && calc.zero.near.length === 0, calc.zero);
  check('parseSlipAmount_: รับ "1,250" / "฿1234.50"; ทศนิยมเกิน 2 ตำแหน่ง/ตัวอักษร/0/ว่าง/ติดลบ/1e3 → null (ไม่เดา)',
    JSON.stringify(calc.parse) === JSON.stringify([1250, 1234.5, null, null, null, null, null, null]), calc.parse);
  check('slipMoney_: ยอดมีสตางค์โชว์ 2 ตำแหน่ง (฿1,234.50) ยอดเต็มบาทไม่มีทศนิยม', calc.money[0] === '฿1,234.50' && calc.money[1] === '฿1,250' && calc.money[2] === '฿0', calc.money);

  // ============ B) หน้าจอ: พิมพ์ / เลือก / ยกเลิก / ล้าง → ไม่มีการเขียน ============
  await type(page, '1250');
  let v = await view(page);
  check('จอ: บิลยอดตรงอยู่บนสุด เรียงใหม่→เก่า อันแรกป้าย "ยอดตรงเป๊ะ" ที่เหลือ "ยอดตรง แต่เก่ากว่า" แล้วจึงตามด้วยใกล้เคียง',
    JSON.stringify(v.btns.map(b => b.kind)) === JSON.stringify(['exact', 'exact', 'exact', 'exact', 'near', 'near', 'near', 'near', 'near'])
    && JSON.stringify(v.exact) === JSON.stringify(['2026-11-12/01', '2026-11-10/01', '2026-11-10/02', '2026-11-08/02'])
    && v.btns[0].text.includes('ยอดตรงเป๊ะ') && v.btns.slice(1, 4).every(b => b.text.includes('ยอดตรง แต่เก่ากว่า')) && v.btns.slice(0, 4).every(b => b.best && b.text.includes('฿1,250')), v.btns);
  const nearTxt = Object.fromEntries(v.btns.filter(b => b.kind === 'near').map(b => [b.code, b.text]));
  check('จอ: ใกล้เคียงแสดงส่วนต่าง + ทิศทาง (05 บิลมากกว่า ฿50 / 09 บิลน้อยกว่า ฿50 / 04 บิลน้อยกว่า ฿15.50) และไม่มีสาขา 11 (เกิน ฿100)',
    nearTxt['05'].includes('บิลมากกว่ายอดโอน ฿50') && nearTxt['09'].includes('บิลน้อยกว่ายอดโอน ฿50') && nearTxt['04'].includes('บิลน้อยกว่ายอดโอน ฿15.50') && nearTxt['04'].includes('฿1,234.50') && !('11' in nearTxt) && nearTxt['10'].includes('บิลมากกว่ายอดโอน ฿100'), nearTxt);
  check('จอ: บิลจ่ายแล้ว (03) / ยอด 0 (08) ไม่ขึ้น และยังไม่มีแผงยืนยันจนกว่าจะเลือกเอง', !v.btns.some(b => b.code === '03' || b.code === '08') && v.panel === null && v.confirm === null, { panel: v.panel });

  // แตะบิลใกล้เคียง → ไม่มีปุ่มยืนยัน
  await pickBill(page, '2026-11-10', '05');
  v = await view(page);
  check('แตะบิลใกล้เคียง → ไม่มีปุ่มยืนยัน/แผงยืนยัน มีแต่ข้อความบอกส่วนต่างให้ไปติ๊กที่แถวบิลเอง',
    v.confirm === null && v.panel === null && v.nearMsg && v.nearMsg.includes('ยอดไม่ตรง (ส่วนต่าง ฿50)') && v.nearMsg.includes('10/11/2026') && !v.btns.some(b => b.picked), { nearMsg: v.nearMsg, confirm: v.confirm });
  const forced = await page.evaluate(async () => { await confirmSlipMatch_(null); return window.__toasts.slice(); });
  check('เรียกยืนยันตรงๆ ขณะเลือกบิลใกล้เคียง → ถูกปฏิเสธ ("เลือกบิลที่ยอดตรงก่อน")', forced.includes('เลือกบิลที่ยอดตรงก่อน'), forced);

  // เลือกบิลยอดตรง → แผงยืนยัน
  await pickBill(page, '2026-11-10', '01');
  v = await view(page);
  check('เลือกบิลยอดตรง → แผงยืนยันโชว์สาขา/วันที่บิล/ยอดบิล/ยอดโอน/ส่วนต่าง ฿0 วันที่โอนตั้งต้น = วันนี้ ปุ่มยืนยันกดได้',
    v.panel && v.panel.includes('01') && v.panel.includes('10/11/2026') && v.panel.includes('ยอดบิล฿1,250') && v.panel.includes('ยอดโอน฿1,250') && v.panel.includes('ส่วนต่าง฿0')
    && v.paidDate === TODAY && v.confirm && v.confirm.disabled === false && v.cancel && v.warn === '' && !v.closed && !v.offline
    && v.btns.filter(b => b.picked).length === 1 && v.btns.find(b => b.picked).iso === '2026-11-10', v);

  // screenshot 420px + ไม่ล้นจอ
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.locator('#slipMatchCard').screenshot({ path: path.join(SHOT_DIR, 'slip-match-420-macaron.png') });
  const ovf1 = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  await page.evaluate(() => applyTheme_('sea', 'full'));
  await page.waitForTimeout(300);
  await page.locator('#slipMatchCard').screenshot({ path: path.join(SHOT_DIR, 'slip-match-420-sea.png') });
  const ovf2 = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  await page.evaluate(() => applyTheme_('', ''));
  await page.waitForTimeout(200);
  check('จอ 420px: การ์ดจับคู่ไม่ล้นจอ (ธีมปกติ + sea)', ovf1 && ovf2, { macaron: ovf1, sea: ovf2 });

  // สลับแท็บไปมา → ยอดที่พิมพ์ไม่หาย
  await page.evaluate(async () => { await switchTab('orders'); await switchTab('billing'); });
  await page.waitForTimeout(500);
  v = await view(page);
  check('สลับแท็บไปออเดอร์แล้วกลับมา → ยอดที่พิมพ์ยังอยู่ (1250) และผลจับคู่ยังแสดง', v.input === '1250' && v.exact.length === 4 && v.near.length === 5, { input: v.input, exact: v.exact });

  // ยกเลิก
  if (!v.panel) await pickBill(page, '2026-11-10', '01');
  await page.click('[data-slipcancel]');
  await page.waitForTimeout(250);
  v = await view(page);
  check('กดยกเลิก → แผงยืนยันหาย ยอดที่พิมพ์และรายการยังอยู่', v.panel === null && v.input === '1250' && v.exact.length === 4 && !v.btns.some(b => b.picked), { panel: v.panel, input: v.input });

  // ยอดพิมพ์ผิดรูป / ไม่มีบิลใกล้เคียง / ล้าง
  await type(page, '12.345');
  const vBad = await view(page);
  await type(page, '99999');
  const vEmpty = await view(page);
  await type(page, '1234');
  const v1234 = await view(page);
  check('พิมพ์ทศนิยมเกิน 2 ตำแหน่ง → บอกให้กรอกเป็นตัวเลข ไม่เสนอบิล', vBad.bad && vBad.btns.length === 0, vBad);
  check('ยอดที่ไม่มีบิลใกล้เคียงเลย → "ไม่พบบิลค้างโอนที่ยอดใกล้เคียง"', vEmpty.empty && vEmpty.btns.length === 0, vEmpty);
  check('ไม่ปัดเศษ: พิมพ์ 1234 → บิล 1,234.50 เป็นแค่ "ใกล้เคียง" (ต่าง ฿0.50) ไม่ใช่ยอดตรง', v1234.exact.length === 0 && v1234.btns.some(b => b.code === '04' && b.kind === 'near' && b.text.includes('บิลมากกว่ายอดโอน ฿0.50')), v1234.btns);
  await page.click('[data-slipclear]');
  await page.waitForTimeout(250);
  v = await view(page);
  check('กดล้าง → ช่องยอดว่าง ไม่มีรายการ', v.input === '' && v.btns.length === 0 && v.panel === null, v);

  let ws = await writes(page);
  const storeAfter = await page.evaluate(() => JSON.stringify(window.__store));
  check('พิมพ์/เลือก/แตะใกล้เคียง/ยกเลิก/ล้าง/สลับแท็บ: ไม่มีการเขียนใดๆ เลย และข้อมูลใน storage เหมือนเดิมทุกตัวอักษร', ws.length === 0 && storeAfter === storeBefore, ws);

  // ============ C) ยืนยัน → patchField เดียว + กดสองครั้งเร็ว → เขียนครั้งเดียว ============
  await type(page, '1250');
  await pickBill(page, '2026-11-10', '01');
  await reset(page);
  await page.evaluate(() => { const b = document.querySelector('[data-slipconfirm]'); b.click(); b.click(); confirmSlipMatch_(b); confirmSlipMatch_(null); });
  await waitIdle(page);
  await page.waitForTimeout(400);
  ws = await writes(page);
  let dw = dayWrites(ws);
  let paid = await paidOf(page, '2026-11-10', '01');
  check('ยืนยัน (กดซ้ำเร็ว 2 ครั้ง + เรียกซ้ำ) → เขียน day: ครั้งเดียว เป็น patchField ที่ day:2026-11-10 path ["billingPaid","01"]',
    dw.length === 1 && dw[0].op === 'patchField' && dw[0].key === 'day:2026-11-10' && JSON.stringify(dw[0].path) === '["billingPaid","01"]', dw);
  check('ยืนยัน: ไม่มี set ทั้งก้อนของ day: และการเขียนอื่นมีแค่ป้ายซิงค์/บันทึกกิจกรรม (dayRevs, actlog)',
    !ws.some(w => w.op === 'set' && String(w.key).startsWith('day:')) && ws.every(w => String(w.key).startsWith('day:') || w.key === 'dayRevs' || String(w.key).startsWith('actlog:')), ws);
  check('ยืนยัน: ค่าที่เขียนถูก {paid:true, paidDate: วันนี้, transferAmount 1250, billedAmount 1250}',
    JSON.stringify(paid) === JSON.stringify({ paid: true, paidDate: TODAY, transferAmount: 1250, billedAmount: 1250 }), paid);
  const others = await page.evaluate(() => { const d = window.__store['day:2026-11-10']; return { keys: Object.keys(d.billingPaid).sort(), orders: Object.keys(d.orders).length, extra: d.billExtra['02'], today: Object.keys(window.__store['day:2026-11-12'].billingPaid || {}), d8: Object.keys(window.__store['day:2026-11-08'].billingPaid || {}) }; });
  check('ยืนยัน: บิลอื่นไม่ถูกแตะ (10/11 จ่ายแล้วมีแค่ 01 กับ 03 เดิม; 12/11 และ 08/11 ยังไม่มีใครจ่าย; ออเดอร์/billExtra คงเดิม)',
    JSON.stringify(others.keys) === '["01","03"]' && others.orders === 9 && others.extra === 50 && others.today.length === 0 && others.d8.length === 0, others);
  let ts = await toasts(page);
  v = await view(page);
  check('ยืนยันสำเร็จ: แจ้ง "ติ๊กจ่ายแล้ว 01 … ฿1,250" และล้างช่องยอด', ts.some(t => t.startsWith('ติ๊กจ่ายแล้ว 01') && t.includes('฿1,250')) && v.input === '' && v.panel === null, { ts, input: v.input });
  await type(page, '1250');
  v = await view(page);
  check('หลังติ๊กจ่าย: บิล 10/11 สาขา 01 หายจากรายการ (เหลือยอดตรง 3 บิล)', JSON.stringify(v.exact) === JSON.stringify(['2026-11-12/01', '2026-11-10/02', '2026-11-08/02']), v.exact);

  // ============ D) วันที่โอนก่อนวันที่บิล → เตือนแต่ติ๊กได้ ============
  await pickBill(page, TODAY, '01');
  await page.fill('#slipMatchPaidDate', '2026-11-11');
  await page.waitForTimeout(150);
  v = await view(page);
  check('วันที่โอน (11/11) ก่อนวันที่บิล (12/11) → มีคำเตือน แต่ปุ่มยืนยันยังกดได้', v.warn.includes('อยู่ก่อนวันที่บิล') && v.warn.includes('11/11/2026') && v.warn.includes('12/11/2026') && v.confirm && v.confirm.disabled === false, { warn: v.warn, confirm: v.confirm });
  await reset(page);
  await page.click('[data-slipconfirm]');
  await waitIdle(page);
  await page.waitForTimeout(400);
  dw = dayWrites(await writes(page));
  paid = await paidOf(page, TODAY, '01');
  check('วันที่โอนก่อนวันที่บิล: ยืนยันได้ เขียน patchField เดียว และ paidDate = วันที่ที่ AY เลือก (2026-11-11)',
    dw.length === 1 && dw[0].op === 'patchField' && dw[0].key === 'day:' + TODAY && JSON.stringify(dw[0].path) === '["billingPaid","01"]' && JSON.stringify(paid) === JSON.stringify({ paid: true, paidDate: '2026-11-11', transferAmount: 1250, billedAmount: 1250 }), { dw, paid });
  const todaySync = await page.evaluate(() => ({ mem: !!(dayData.billingPaid || {})['01'], other: !!(dayData.billingPaid || {})['09'] }));
  check('บิลของวันที่เปิดอยู่: ข้อมูลในหน่วยความจำ (dayData) ตรงกับที่เขียน และสาขาอื่นของวันนั้นไม่ถูกติ๊ก', todaySync.mem && !todaySync.other, todaySync);

  // ============ E) อีกเครื่องจ่ายไปก่อน → บล็อก ============
  await type(page, '1250');
  await pickBill(page, '2026-11-10', '02');
  const otherPaid = { paid: true, paidDate: '2026-11-11', transferAmount: 1250, billedAmount: 1250 };
  await page.evaluate(p => { window.__store['day:2026-11-10'].billingPaid['02'] = p; }, otherPaid);
  await reset(page);
  await page.click('[data-slipconfirm]');
  await waitIdle(page);
  await page.waitForTimeout(400);
  ws = await writes(page); ts = await toasts(page); v = await view(page);
  paid = await paidOf(page, '2026-11-10', '02');
  check('อีกเครื่องติ๊กจ่ายไปก่อน → บล็อก: ไม่มีการเขียนเลย ค่าของอีกเครื่องยังอยู่ครบ ไม่ถูกทับ', ws.length === 0 && JSON.stringify(paid) === JSON.stringify(otherPaid), { ws, paid });
  check('อีกเครื่องติ๊กจ่ายไปก่อน: บอกชัด "บิลนี้ถูกติ๊กจ่ายแล้ว ไม่ได้บันทึกซ้ำ" (toast + ป้ายในการ์ด) และบิลนั้นหายจากรายการ',
    ts.includes('บิลนี้ถูกติ๊กจ่ายแล้ว ไม่ได้บันทึกซ้ำ') && v.note === 'บิลนี้ถูกติ๊กจ่ายแล้ว ไม่ได้บันทึกซ้ำ' && v.panel === null && !v.exact.includes('2026-11-10/02') && !ts.some(t => t.startsWith('ติ๊กจ่ายแล้ว')), { ts, note: v.note, exact: v.exact });

  // ============ F) ยอดบิลเปลี่ยนระหว่างเลือก → บล็อก ============
  await type(page, '1250');
  await pickBill(page, '2026-11-08', '02');
  await page.evaluate(() => { window.__store['day:2026-11-08'].orders['02'].custom[0].price = 1300; });
  await reset(page);
  await page.click('[data-slipconfirm]');
  await waitIdle(page);
  await page.waitForTimeout(400);
  ws = await writes(page); ts = await toasts(page); v = await view(page);
  paid = await paidOf(page, '2026-11-08', '02');
  check('ยอดบิลเปลี่ยน (1,250 → 1,300) → บล็อก: ไม่มีการเขียนเลย บิลยังไม่ถูกติ๊กจ่าย', ws.length === 0 && paid === undefined, { ws, paid });
  check('ยอดบิลเปลี่ยน: โชว์ค่าเก่า → ใหม่ "ยอดบิลเปลี่ยน ฿1,250 → ฿1,300 ยังไม่ได้ติ๊กจ่าย" และบิลนั้นไม่อยู่ในยอดตรงแล้ว',
    ts.includes('ยอดบิลเปลี่ยน ฿1,250 → ฿1,300 ยังไม่ได้ติ๊กจ่าย') && v.note === 'ยอดบิลเปลี่ยน ฿1,250 → ฿1,300 ยังไม่ได้ติ๊กจ่าย' && v.panel === null && !v.exact.includes('2026-11-08/02'), { ts, note: v.note, exact: v.exact, near: v.near });

  // ============ G) ยอดมีสตางค์ 1234.50 ============
  await type(page, '1234.50');
  v = await view(page);
  check('ยอดสตางค์: พิมพ์ 1234.50 → บิล 10/11 สาขา 04 เป็นยอดตรงเป๊ะ โชว์ ฿1,234.50', JSON.stringify(v.exact) === '["2026-11-10/04"]' && v.btns[0].text.includes('฿1,234.50') && v.btns[0].text.includes('ยอดตรงเป๊ะ'), v.btns);
  await pickBill(page, '2026-11-10', '04');
  v = await view(page);
  const panelSatang = v.panel;
  await reset(page);
  await page.click('[data-slipconfirm]');
  await waitIdle(page);
  await page.waitForTimeout(400);
  dw = dayWrites(await writes(page));
  paid = await paidOf(page, '2026-11-10', '04');
  check('ยอดสตางค์: แผงยืนยันโชว์ ฿1,234.50 ทั้งยอดบิลและยอดโอน; ยืนยัน → patchField เดียว ค่า transferAmount/billedAmount = 1234.5 (ไม่ปัด)',
    panelSatang && panelSatang.includes('ยอดบิล฿1,234.50') && panelSatang.includes('ยอดโอน฿1,234.50') && dw.length === 1 && dw[0].op === 'patchField' && JSON.stringify(dw[0].path) === '["billingPaid","04"]'
    && JSON.stringify(paid) === JSON.stringify({ paid: true, paidDate: TODAY, transferAmount: 1234.5, billedAmount: 1234.5 }), { panelSatang, dw, paid });

  // ============ H) ออฟไลน์ → ปุ่มปิด ไม่เขียน ============
  await type(page, '1300');
  await page.evaluate(() => { window.__forceOffline = true; });
  await pickBill(page, '2026-11-10', '05');
  v = await view(page);
  await reset(page);
  await page.evaluate(async () => { const b = document.querySelector('[data-slipconfirm]'); b.click(); await confirmSlipMatch_(b); await confirmSlipMatch_(null); });
  await page.waitForTimeout(400);
  ws = await writes(page); ts = await toasts(page);
  paid = await paidOf(page, '2026-11-10', '05');
  const offQ = await page.evaluate(() => readOfflineQueue_().length);
  check('ออฟไลน์: แผงยืนยันมีป้าย "ต้องต่อเน็ตก่อนจับคู่" และปุ่มยืนยันถูกปิด (disabled)', v.offline && v.confirm && v.confirm.disabled === true, { offline: v.offline, confirm: v.confirm });
  check('ออฟไลน์: แม้เรียกยืนยันตรงๆ ก็ไม่เขียน ไม่เข้าคิวออฟไลน์ บิลยังไม่ถูกติ๊ก', ws.length === 0 && offQ === 0 && paid === undefined && ts.includes('ต้องต่อเน็ตก่อนจับคู่') && !ts.some(t => t.startsWith('ติ๊กจ่ายแล้ว')), { ws, offQ, paid, ts });
  await page.evaluate(() => { window.__forceOffline = false; });

  // เน็ตหลุดระหว่างเช็คข้อมูลสด (ก่อนเขียน) → ไม่เขียน ไม่บอกสำเร็จ
  await type(page, '1300');
  await pickBill(page, '2026-11-10', '05');
  v = await view(page);
  const onlineBtn = v.confirm && v.confirm.disabled === false && !v.offline;
  await page.evaluate(() => {
    const raw = Object.getPrototypeOf(window.storage);
    const origGet = raw.get;
    window.__restoreGet = () => { raw.get = origGet; };
    raw.get = async function (key) { const r = await origGet.call(this, key); if (key === 'day:2026-11-10') window.__forceOffline = true; return r; };
  });
  await reset(page);
  await page.click('[data-slipconfirm]');
  await waitIdle(page);
  await page.waitForTimeout(400);
  ws = await writes(page); ts = await toasts(page);
  paid = await paidOf(page, '2026-11-10', '05');
  const offQ2 = await page.evaluate(() => { window.__restoreGet(); const n = readOfflineQueue_().length; window.__forceOffline = false; return n; });
  check('กลับมาออนไลน์: ปุ่มยืนยันเปิดใช้ได้อีก', onlineBtn, v.confirm);
  check('เน็ตหลุดหลังเช็คข้อมูลสดแต่ก่อนเขียน → ไม่เขียน ไม่เข้าคิว ไม่บอกว่าสำเร็จ ("ต้องต่อเน็ตก่อนจับคู่ ยังไม่ได้ติ๊กจ่าย")',
    ws.length === 0 && offQ2 === 0 && paid === undefined && ts.includes('ต้องต่อเน็ตก่อนจับคู่ ยังไม่ได้ติ๊กจ่าย') && !ts.some(t => t.startsWith('ติ๊กจ่ายแล้ว')), { ws, offQ2, paid, ts });
  await page.context().close();

  // ============ I) เดือนปิดแล้ว → ติ๊กได้ มีป้าย ============
  page = await open({
    ['day:' + TODAY]: mkDay({}),
    ['day:2026-10-20']: mkDay({ orders: { '01': bill(777), '02': bill(500) }, purchases: [{ id: 'pu1', productId: 'p4', qty: 1, price: 100 }] }),
    closedMonths: { '2026-10': { at: '2026-11-01T00:00:00Z', dev: 'iPhone' } },
  });
  const closedOk = await page.evaluate(() => isMonthClosed_('2026-10-20'));
  await type(page, '777');
  await pickBill(page, '2026-10-20', '01');
  v = await view(page);
  check('เดือนปิดแล้ว: แผงยืนยันมีป้าย "เดือนของบิลปิดแล้ว (ติ๊กจ่ายได้ตามปกติ)" และปุ่มยืนยันกดได้', closedOk && v.closed && v.panel.includes('เดือนของบิลปิดแล้ว') && v.confirm && v.confirm.disabled === false, { closedOk, closed: v.closed, confirm: v.confirm });
  const closedBefore = await page.evaluate(() => JSON.stringify(window.__store['day:2026-10-20']));
  await reset(page);
  await page.click('[data-slipconfirm]');
  await waitIdle(page);
  await page.waitForTimeout(400);
  ws = await writes(page); dw = dayWrites(ws); ts = await toasts(page);
  paid = await paidOf(page, '2026-10-20', '01');
  const closedAfter = await page.evaluate(() => { const d = JSON.parse(JSON.stringify(window.__store['day:2026-10-20'])); delete d.billingPaid['01']; return JSON.stringify(d); });
  check('เดือนปิดแล้ว: ติ๊กจ่ายได้ — patchField เดียวที่ ["billingPaid","01"] ค่าถูก ไม่มี set ทั้งก้อน',
    dw.length === 1 && dw[0].op === 'patchField' && dw[0].key === 'day:2026-10-20' && JSON.stringify(dw[0].path) === '["billingPaid","01"]' && !ws.some(w => w.op === 'set' && String(w.key).startsWith('day:'))
    && JSON.stringify(paid) === JSON.stringify({ paid: true, paidDate: TODAY, transferAmount: 777, billedAmount: 777 }) && ts.some(t => t.startsWith('ติ๊กจ่ายแล้ว 01')), { dw, paid, ts });
  check('เดือนปิดแล้ว: ข้อมูลอื่นของวันนั้น (ออเดอร์/ต้นทุนซื้อ/บิลสาขาอื่น) ไม่เปลี่ยนแม้ตัวอักษรเดียว', closedAfter === closedBefore);
  await page.context().close();

  // ============ J) ไม่มีบิลค้างโอนเลย ============
  page = await open({
    ['day:' + TODAY]: mkDay({ orders: { '01': bill(1250) }, billingPaid: { '01': { paid: true, paidDate: TODAY } } }),
  });
  await reset(page);
  await type(page, '1250');
  v = await view(page);
  ws = await writes(page);
  check('ไม่มีบิลค้างโอนเลย (จ่ายครบแล้ว) → "ไม่พบบิลค้างโอนที่ยอดใกล้เคียง" ไม่มีปุ่มใดๆ ไม่มีการเขียน', v.empty && v.btns.length === 0 && v.confirm === null && ws.length === 0, { v, ws });
  await page.context().close();

  await finish(browser);
})();
