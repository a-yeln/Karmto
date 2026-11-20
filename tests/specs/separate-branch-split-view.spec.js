const path = require('path');
const { launch, mkDay, openApp, makeChecker, stripBanner, installMockStorage } = require('../helpers');

// แยกส่ง ชุด 1 (ส่วน A–D): สาขาคู่ 13 + 13T (ติ๊กแยกส่ง) = การ์ดเดียว แถวรวม + กล่องย่อยต่อรหัส; บิลรายวันมีชิป "4+2"
// เส้นคั่น "🚚 แยกส่ง" + ยอดย่อย; ปุ่มสลับลำดับ 'last' | 'pair' จำต่อเครื่อง (localStorage karmto.sepOrder)
// กฎเหล็ก: ติ๊กจ่ายเขียน patch billingPaid[รหัสกล่องนั้น] อย่างเดียว ไม่ set ทั้งวัน; Brand fee ไม่เปลี่ยน; ดูอย่างเดียว = ไม่เขียนอะไร
const TODAY = '2026-11-20';
const SHOT_DIR = process.env.SHOT_DIR || path.join(__dirname, '..', 'screenshots');

function seedStore(){
  return {
    rawLots: [],
    'day:2026-11-15': mkDay({ orders: { '13T': { p1: 1 } } }),                       // วันมีแต่แยกส่ง
    'day:2026-11-16': mkDay({ orders: { '01': { p1: 1 }, '02': { p6: 1 } } }),         // วันไม่มีแยกส่งเลย
    'day:2026-11-17': mkDay({ orders: { '13': { p1: 1 }, '19T': { p1: 1 }, '77T': { p1: 2 } },
      billingPaid: { '13': { paid: true, paidDate: '2026-11-17', transferAmount: 1, billedAmount: 1 } } }),
    'day:2026-11-18': mkDay({ orders: { '13': { p1: 2, p6: 1 }, '13T': { p1: 1 }, '02': { p1: 1 } } }),
    'day:2026-11-19': mkDay({ orders: { '13': { p3: 2 }, '13T': { p6: 2, p1: 1 } },
      billExtra: { '13': -20, '13T': 50 }, shortQty: { '13': { p3: 0.5 } }, noStock: { all: {}, branch: { '13T': { p6: true } } } }),
    ['day:' + TODAY]: mkDay({ orders: { '02': { p6: 1 }, '03': { custom: [{ name: 'ซอส', qty: 2, price: 30 }] }, '13': { p1: 1 },
      '16': { p1: 1 }, '13T': { p7: 3 }, '16S': { p1: 1 } } }),
  };
}

// ทำซ้ำขั้นหลัง goto ของ openApp (ใช้หลัง reload) + ตั้งสาขาเพิ่ม 13T/19T/77T (ติ๊กแยกส่ง)
async function seedAfterBoot(page, store){
  await page.waitForFunction(() => typeof settings !== 'undefined' && settings && settings.branches, null, { timeout: 15000 });
  await stripBanner(page);
  await installMockStorage(page);
  await page.evaluate(({ store, date }) => {
    Object.assign(window.__store, store);
    currentDate = date;
    dayData = normalizeDay_(JSON.parse(JSON.stringify(window.__store['day:' + date])));
    dayCache_[date] = dayData;
  }, { store, date: TODAY });
  await addBranches(page);
}
async function addBranches(page){
  await page.evaluate(() => {
    const add = b => { if(!settings.branches.some(x => x.code === b.code)) settings.branches.push(b); };
    add({ code: '13T', area: '', label: 'สาขา 13(แยกส่ง)', separate: true, billName: '', billAddr: '', billTax: '' });
    add({ code: '19T', area: '', label: 'สาขา 19(แยกส่ง)', separate: true, billName: '', billAddr: '', billTax: '' });
    add({ code: '77T', area: '', label: 'สาขา 77(แยกส่ง)', separate: true, billName: '', billAddr: '', billTax: '' });
    populateDashBranchSelect();
    const os = document.getElementById('outstandingBranchFilter');
    os.innerHTML = '<option value="">— ทุกสาขา —</option>'; // ให้ renderOutstanding เติมรายชื่อใหม่ (มี 13T)
    // ค่าที่คาดหวังของกลุ่ม คิดจาก __store ตรงๆ ด้วยสูตรเดิม branchBillAmount(row, iso, d, code) + billExtra
    window.__expGroup = codes => {
      const per = {}; codes.forEach(c => per[c] = { unpaidCount: 0, unpaidTotal: 0, allTimeTotal: 0, orderCount: 0 });
      Object.keys(window.__store).filter(k => k.startsWith('day:')).forEach(k => {
        const iso = k.slice(4), d = normalizeDay_(JSON.parse(JSON.stringify(window.__store[k])));
        codes.forEach(c => {
          const row = d.orders[c]; if(!orderRowHasOrder_(row)) return;
          const amt = branchBillAmount(row, iso, d, c) + Number(d.billExtra[c] || 0);
          const p = per[c]; p.allTimeTotal += amt; p.orderCount++;
          if(!d.billingPaid[c]){ p.unpaidCount++; p.unpaidTotal += amt; }
        });
      });
      const sum = f => codes.reduce((s, c) => s + per[c][f], 0);
      return { per, unpaidCount: sum('unpaidCount'), unpaidTotal: sum('unpaidTotal'), allTimeTotal: sum('allTimeTotal') };
    };
  });
}

const num = t => Number(String(t || '').replace(/[^\d-]/g, ''));
// อ่านการ์ดคู่: แถวรวม + KPI ต่อกล่อง + จำนวนแถวบิลต่อกล่อง
const readPair = (page, cId) => page.evaluate(cId => {
  const el = document.getElementById(cId);
  const pt = k => { const x = el.querySelector(`[data-pairtotal="${k}"]`); return x ? x.textContent : null; };
  const parts = Array.from(el.querySelectorAll('.branchpair-part')).map(p => {
    const box = p.querySelector('[id*="__part_"]');
    const kpi = Array.from(box.querySelectorAll(':scope > .dash-grid .dm-value')).map(v => v.textContent);
    return { head: p.querySelector('.branchpair-parthead').textContent.trim(), id: box.id, kpi, rows: box.querySelectorAll('.branchbill').length, cls: box.className };
  });
  return { has: !!el.querySelector('.branchpair'), cls: el.className, code: el.dataset.branchCode, text: el.textContent,
    totals: { unpaidCount: pt('unpaidCount'), unpaidTotal: pt('unpaidTotal'), allTimeTotal: pt('allTimeTotal') }, parts,
    partIds: Array.from(el.querySelectorAll('[id*="__part_"]')).map(x => x.id) };
}, cId);
const waitPair = (page, cId, n) => page.waitForFunction(({ cId, n }) => {
  const el = document.getElementById(cId);
  const boxes = el ? el.querySelectorAll('.branchpair-part [id*="__part_"]') : [];
  return boxes.length === n && Array.from(boxes).every(b => b.className === '' && b.querySelector('.dash-grid'));
}, { cId, n }, { timeout: 10000 });
const waitSingle = (page, cId, code) => page.waitForFunction(({ cId, code }) => {
  const el = document.getElementById(cId);
  return el && el.dataset.branchCode === code && el.className === '' && el.querySelector('.dash-grid') && !el.querySelector('.branchpair');
}, { cId, code }, { timeout: 10000 });
const selectDash = (page, code) => page.evaluate(code => { const s = document.getElementById('dashBranchSelect'); s.value = code; s.dispatchEvent(new Event('change')); }, code);
const writesSince = (page, n) => page.evaluate(n => window.__writes.slice(n).map(w => ({ op: w.op, key: w.key, path: w.path, ops: w.ops })), n);
const wlen = page => page.evaluate(() => window.__writes.length);
const dayWrites = ws => ws.filter(w => w.key && w.key.startsWith('day:'));
const setTheme = (page, th) => page.evaluate(th => {
  if(th){ document.documentElement.setAttribute('data-theme', th); document.documentElement.setAttribute('data-tmode', 'full'); }
  else { document.documentElement.removeAttribute('data-theme'); document.documentElement.removeAttribute('data-tmode'); }
}, th);
const shot = async (page, sel, name) => {
  const clip = await page.evaluate(sel => { const el = document.querySelector(sel); if(!el) return null; el.scrollIntoView(); window.scrollBy(0, -220); const r = el.getBoundingClientRect(); return { x: 0, y: Math.max(0, r.top + scrollY - 8), width: 420, height: Math.min(1400, r.height + 16) }; }, sel);
  if(clip) await page.screenshot({ path: path.join(SHOT_DIR, name), clip, fullPage: true }).catch(() => {});
};

(async () => {
  const browser = await launch();
  const { check, finish } = makeChecker();
  const page = await openApp(browser, { store: seedStore(), date: TODAY });
  await page.clock.setFixedTime(new Date(TODAY + 'T10:00:00+07:00'));
  await page.evaluate(() => { try{ localStorage.removeItem('karmto.sepOrder'); }catch(e){} sepOrderMem_ = null; });
  await addBranches(page);

  // ---------- A: ตัวช่วยล้วน ----------
  const A = await page.evaluate(async () => {
    const agg = await computeBranchAggregates();
    return {
      g: [branchSameGroup_('13', '13T'), branchSameGroup_('13T', '13'), branchSameGroup_('13', '02'), branchSameGroup_('', '13'), branchSameGroup_('02', '02')],
      p13: branchPairParts_('13', agg), p13T: branchPairParts_('13T', agg), p02: branchPairParts_('02', agg),
      p19T: branchPairParts_('19T', agg), p77T: branchPairParts_('77T', agg),
      cmp: ['16S', '13T', '16', '02', '13', '03'].sort(pairCodeCmp_),
      fee: Object.fromEntries(Object.keys(window.__store).filter(k => k.startsWith('day:')).map(k => { const d = normalizeDay_(JSON.parse(JSON.stringify(window.__store[k]))); return [k, computeFeeTotals(d.orders, d)]; })),
      pref: sepOrderPref_(),
    };
  });
  check('A: branchSameGroup_ สมมาตร 13↔13T, ไม่จับ 02, ค่าว่าง = false', JSON.stringify(A.g) === '[true,true,false,false,true]', A.g);
  check('A: เปิด 13 หรือ 13T ได้ส่วนเดียวกัน [13,13T] (13S ไม่มีบิล ไม่โผล่)', A.p13.join() === '13,13T' && A.p13T.join() === '13,13T', [A.p13, A.p13T]);
  check('A: 02 ไม่มีคู่ / 19T (สาขา 19 ไม่มีบิล) / 77T (ไม่มีสาขา 77) = กล่องเดียว', A.p02.join() === '02' && A.p19T.join() === '19T' && A.p77T.join() === '77T', [A.p02, A.p19T, A.p77T]);
  check('A: pairCodeCmp_ เรียง 02,03,13,13T,16,16S', A.cmp.join() === '02,03,13,13T,16,16S', A.cmp);
  check('A: ค่าเริ่มต้นลำดับ = last', A.pref === 'last', A.pref);
  check('A: Brand fee วันนี้ไม่นับ 13T/16S (p1=2 จาก 13+16, p6=1 จาก 02, p7=0)', A.fee['day:' + TODAY].p1 === 2 && A.fee['day:' + TODAY].p6 === 1 && A.fee['day:' + TODAY].p7 === 0, A.fee['day:' + TODAY]);
  const amt19 = await page.evaluate(() => { const d = normalizeDay_(JSON.parse(JSON.stringify(window.__store['day:2026-11-19']))); return {
    a13: branchBillAmount(d.orders['13'], '2026-11-19', d, '13') + Number(d.billExtra['13'] || 0), e13: 1.5 * priceOnDate('p3', '2026-11-19') - 20,
    a13T: branchBillAmount(d.orders['13T'], '2026-11-19', d, '13T') + Number(d.billExtra['13T'] || 0), e13T: priceOnDate('p1', '2026-11-19') + 50 }; });
  check('A: ข้อมูลตั้งต้นมีผล shortQty/noStock/billExtra จริง (13 = 1.5×p3−20, 13T = p1+50)', Math.abs(amt19.a13 - amt19.e13) < 0.001 && Math.abs(amt19.a13T - amt19.e13T) < 0.001, amt19);

  // ---------- C: บิลรายวัน ----------
  await page.evaluate(async () => { window.__writes = []; await switchTab('billing'); });
  await stripBanner(page);
  await page.waitForSelector('#billingList .branchbill', { timeout: 8000 });
  const readBilling = () => page.evaluate(() => {
    const list = document.getElementById('billingList');
    const kids = Array.from(list.children).map(el => el.classList.contains('billsep') ? 'SEP' : el.classList.contains('billsub') ? 'SUB' : (el.querySelector('.code') || {}).textContent);
    const sep = list.querySelector('.billsep'), sub = list.querySelector('.billsub');
    const amts = {}; list.querySelectorAll('.branchbill').forEach(b => { amts[b.querySelector('.code').textContent] = b.querySelector('.amt').textContent; });
    const btn = document.getElementById('billSepOrderToggle');
    return { kids, codes: Array.from(list.querySelectorAll('.branchbill .code')).map(e => e.textContent), sepText: sep && sep.textContent, subText: sub && sub.textContent,
      sepBad: !!list.querySelector('.billsep.branchbill, .billsep .code, .billsub.branchbill, .billsub .code'),
      chip: (document.querySelector('#billingTodayStats .statchip b') || {}).textContent, tags: Array.from(list.querySelectorAll('.branchbill .billsep-tag')).map(t => t.closest('.branchbill').querySelector('.code').textContent),
      amts, btn: btn && { txt: btn.textContent, shown: btn.style.display !== 'none' } };
  });
  const B1 = await readBilling();
  const dayAmt = await page.evaluate(() => { const o = {}; Object.entries(dayData.orders).forEach(([c, r]) => { if(orderRowHasOrder_(r)) o[c] = branchBillAmount(r, currentDate, dayData, c) + Number(dayData.billExtra[c] || 0); }); return o; });
  const sumOf = cs => cs.reduce((s, c) => s + dayAmt[c], 0);
  check('C: ชิปสาขา = "4+2" (03 มีแต่ + อื่นๆ ถูกนับ)', B1.chip === '4+2', B1.chip);
  check('C: โหมด last: 02,03,13,16 → ยอดย่อย → เส้นคั่น → 13T,16S', B1.kids.join() === '02,03,13,16,SUB,SEP,13T,16S', B1.kids);
  check('C: เส้นคั่น/ยอดย่อยไม่มีคลาส .branchbill/.code (จำนวน .branchbill .code = 6)', !B1.sepBad && B1.codes.length === 6, B1.codes);
  check('C: ยอดย่อยปกติ = 4 สาขา + ยอดถูก', /ส่งปกติ 4 สาขา/.test(B1.subText) && num(B1.subText.split('·')[1]) === Math.round(sumOf(['02', '03', '13', '16'])), B1.subText);
  check('C: เส้นคั่น "🚚 แยกส่ง · 2 สาขา" + ยอดแยกส่งถูก', /🚚 แยกส่ง · 2 สาขา/.test(B1.sepText) && num(B1.sepText.split('·')[2]) === Math.round(sumOf(['13T', '16S'])), B1.sepText);
  const allDay = Math.round(sumOf(Object.keys(dayAmt)));
  check('C: ยอดย่อยปกติ + แยกส่ง = ยอดรวมวัน', num(B1.subText.split('·')[1]) + num(B1.sepText.split('·')[2]) === allDay, { allDay });
  check('C: ยอดแถว 03 (custom ล้วน) = 60', num(B1.amts['03']) === 60, B1.amts['03']);
  check('C: ปุ่มสลับโชว์ (วันมีแยกส่ง) ข้อความ "🔀 แยกส่งไว้ท้าย"', B1.btn && B1.btn.shown && B1.btn.txt === '🔀 แยกส่งไว้ท้าย', B1.btn);
  check('C: โหมด last ไม่มีป้าย "แยกส่ง" ในแถว', B1.tags.length === 0, B1.tags);
  for(const th of ['', 'neon']){
    await setTheme(page, th);
    await page.waitForTimeout(150);
    await shot(page, '#billingList', `split-billing-${th || 'macaron'}.png`);
    check(`C: บิลรายวันไม่ล้นจอ 420px (${th || 'macaron'})`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await setTheme(page, '');

  // วันไม่มีแยกส่ง / วันมีแต่แยกส่ง
  const otherDay = async iso => { await page.evaluate(iso => { currentDate = iso; dayData = normalizeDay_(JSON.parse(JSON.stringify(window.__store['day:' + iso]))); dayCache_[iso] = dayData; renderBillingList(); }, iso); return readBilling(); };
  const B16 = await otherDay('2026-11-16');
  check('C: วันไม่มีแยกส่ง: ชิป "2" ไม่มี "+0", ไม่มีเส้นคั่น/ยอดย่อย, ซ่อนปุ่มสลับ', B16.chip === '2' && !B16.sepText && !B16.subText && !B16.btn.shown, B16);
  const B15 = await otherDay('2026-11-15');
  check('C: วันมีแต่แยกส่ง: ชิป "0+1", มีเส้นคั่น 1 สาขา ไม่มียอดย่อยปกติ', B15.chip === '0+1' && /1 สาขา/.test(B15.sepText || '') && !B15.subText && B15.kids.join() === 'SEP,13T', B15);
  await otherDay(TODAY);

  // สลับเป็น "ติดคู่สาขา"
  const outOrder = () => page.evaluate(iso => Array.from(document.querySelectorAll('#outstandingList [data-outstandingrow]')).map(r => r.getAttribute('data-outstandingrow')).filter(k => k.startsWith(iso + '|')).map(k => k.split('|')[1]), TODAY);
  await page.waitForFunction(() => document.querySelectorAll('#outstandingList [data-outstandingrow]').length > 0, null, { timeout: 8000 });
  const O1 = await outOrder();
  check('D: หน้ารวมโหมด last วันเดียวกัน: 02,03,13,16,13T,16S', O1.join() === '02,03,13,16,13T,16S', O1);
  await page.click('#billSepOrderToggle');
  await page.waitForFunction(() => document.getElementById('outSepOrderToggle').textContent === '🔗 ติดคู่สาขา' && !document.querySelector('#outstandingList .loading'), null, { timeout: 8000 });
  await page.waitForFunction(iso => { const k = Array.from(document.querySelectorAll('#outstandingList [data-outstandingrow]')).map(r => r.getAttribute('data-outstandingrow')).filter(k => k.startsWith(iso + '|')); return k.length === 6; }, TODAY, { timeout: 8000 });
  const B2 = await readBilling();
  check('C: โหมด pair: 02,03,13,13T,16,16S ไม่มีเส้นคั่น/ยอดย่อย', B2.kids.join() === '02,03,13,13T,16,16S' && !B2.sepText && !B2.subText, B2.kids);
  check('C: โหมด pair: ป้าย "แยกส่ง" ติดเฉพาะ 13T/16S + ปุ่มขึ้น "🔗 ติดคู่สาขา"', B2.tags.join() === '13T,16S' && B2.btn.txt === '🔗 ติดคู่สาขา', B2);
  const O2 = await outOrder();
  check('D: หน้ารวมโหมด pair วันเดียวกัน: 02,03,13,13T,16,16S', O2.join() === '02,03,13,13T,16,16S', O2);
  const ls1 = await page.evaluate(() => localStorage.getItem('karmto.sepOrder'));
  check('C: จำค่า localStorage karmto.sepOrder = pair', ls1 === 'pair', ls1);
  const wView = await page.evaluate(() => window.__writes.map(w => w.op + ':' + w.key));
  check('ดูบิลรายวัน/สลับลำดับ ไม่เขียนข้อมูลร้านเลย', wView.length === 0, wView);
  for(const th of ['', 'neon']){
    await setTheme(page, th); await page.waitForTimeout(150);
    await shot(page, '#billingList', `split-billing-pair-${th || 'macaron'}.png`);
  }
  await setTheme(page, '');

  // รีโหลด → ยังเป็น pair (อ่านจาก localStorage)
  await page.reload({ waitUntil: 'domcontentloaded' });
  await seedAfterBoot(page, seedStore());
  await page.clock.setFixedTime(new Date(TODAY + 'T10:00:00+07:00'));
  await page.evaluate(() => renderBillingList());
  const B3 = await readBilling();
  check('C: หลังรีโหลดยังเป็นติดคู่สาขา (13 แล้ว 13T)', B3.kids.join() === '02,03,13,13T,16,16S' && B3.btn.txt === '🔗 ติดคู่สาขา', B3.kids);
  const bad = await page.evaluate(() => { localStorage.setItem('karmto.sepOrder', '<x>'); sepOrderMem_ = null; const p = sepOrderPref_(); renderBillingList(); return { p, sep: !!document.querySelector('#billingList .billsep') }; });
  check('C: ค่า karmto.sepOrder เสีย → ตกไป last (มีเส้นคั่นกลับมา)', bad.p === 'last' && bad.sep, bad);
  await page.evaluate(() => setSepOrderPref_('last'));

  // ---------- B: การ์ดคู่บนแดชบอร์ด (ดรอปดาวน์) ----------
  await page.evaluate(async () => { await switchTab('dashboard'); });
  await stripBanner(page);
  await page.evaluate(() => { window.__writes = []; });
  await selectDash(page, '13');
  await waitPair(page, 'dashBranchDetail', 2);
  const P1 = await readPair(page, 'dashBranchDetail');
  const E1 = await page.evaluate(() => window.__expGroup(['13', '13T']));
  check('B: เปิด 13 → การ์ดคู่ 2 กล่อง หัว "📦 ส่งปกติ 13" / "🚚 แยกส่ง 13T"', P1.has && P1.parts.length === 2 && P1.parts[0].head === '📦 ส่งปกติ 13' && P1.parts[1].head === '🚚 แยกส่ง 13T', P1.parts.map(p => p.head));
  check('B: แถวรวม = branchBillAmount+billExtra (ปน billExtra/shortQty/noStock)', num(P1.totals.unpaidCount) === E1.unpaidCount && num(P1.totals.unpaidTotal) === Math.round(E1.unpaidTotal) && num(P1.totals.allTimeTotal) === Math.round(E1.allTimeTotal), { shown: P1.totals, exp: E1 });
  check('B: กล่อง 13 + กล่อง 13T = แถวรวม (ค้างโอน/สะสม)', num(P1.parts[0].kpi[1]) + num(P1.parts[1].kpi[1]) === num(P1.totals.unpaidTotal) && num(P1.parts[0].kpi[3]) + num(P1.parts[1].kpi[3]) === num(P1.totals.allTimeTotal) && num(P1.parts[0].kpi[0]) + num(P1.parts[1].kpi[0]) === num(P1.totals.unpaidCount), P1.parts.map(p => p.kpi));
  check('B: กล่องย่อยแต่ละรหัสตรงค่าของตัวเอง', num(P1.parts[0].kpi[1]) === Math.round(E1.per['13'].unpaidTotal) && num(P1.parts[1].kpi[1]) === Math.round(E1.per['13T'].unpaidTotal) && num(P1.parts[0].kpi[2]) === E1.per['13'].orderCount, P1.parts.map(p => p.kpi));
  check('B: container ไม่ค้างคลาส loading + dataset.branchCode = 13', P1.cls === '' && P1.code === '13' && !/กำลังโหลด/.test(P1.text), { cls: P1.cls, code: P1.code });
  for(const th of ['', 'neon']){
    await setTheme(page, th); await page.waitForTimeout(150);
    await shot(page, '#dashBranchDetail', `split-paircard-${th || 'macaron'}.png`);
    check(`B: การ์ดคู่ไม่ล้นจอ 420px (${th || 'macaron'})`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await setTheme(page, '');
  await selectDash(page, '13T');
  await page.waitForFunction(() => document.getElementById('dashBranchDetail').dataset.branchCode === '13T', null, { timeout: 8000 });
  await waitPair(page, 'dashBranchDetail', 2);
  const P2 = await readPair(page, 'dashBranchDetail');
  check('B: เปิด 13T ได้การ์ดคู่เดียวกัน (หัว/แถวรวมเท่ากัน)', JSON.stringify(P2.totals) === JSON.stringify(P1.totals) && P2.parts.map(p => p.head).join() === P1.parts.map(p => p.head).join(), P2.totals);
  // ปุ่มเรียงวันที่ในกล่องย่อย → การ์ดคู่ยังอยู่
  await page.click('#dashBranchDetail__part_0 #branchDetailDateSortBtn');
  await page.waitForFunction(() => /เก่าสุด→ล่าสุด/.test((document.querySelector('#dashBranchDetail__part_0 #branchDetailDateSortBtn') || {}).textContent || ''), null, { timeout: 8000 });
  const P3 = await readPair(page, 'dashBranchDetail');
  check('B: กดเรียงวันที่ในกล่องย่อย การ์ดคู่/แถวรวมยังอยู่ ไม่วนซ้อน', P3.has && P3.parts.length === 2 && JSON.stringify(P3.totals) === JSON.stringify(P1.totals) && P3.partIds.every(id => /^dashBranchDetail__part_\d$/.test(id)), P3.partIds);
  for(const [c, lbl] of [['02', 'ไม่มีคู่'], ['19T', 'มีแต่ T (19 ไม่มีบิล)'], ['77T', 'มีแต่ T (ไม่มีสาขา 77)']]){
    await selectDash(page, c);
    await waitSingle(page, 'dashBranchDetail', c);
    const S = await readPair(page, 'dashBranchDetail');
    check(`B: ${c} ${lbl} → การ์ดเดิม ไม่มี __part_/แถวรวม`, !S.has && S.partIds.length === 0 && S.totals.unpaidTotal === null, S.partIds);
  }
  const wDash = await page.evaluate(() => window.__writes.map(w => w.op + ':' + w.key));
  check('B: เปิด/สลับการ์ด/เรียงวันที่ ไม่เขียนข้อมูลเลย', wDash.length === 0, wDash);

  // 13 → 01 → 13T แล้วติ๊กจ่ายบิล 13 (18/11) ในกล่อง 13: ไม่กระพริบ "กำลังโหลด…", ไม่เด้งสาขา, กล่อง 13T ไม่ขยับ
  await selectDash(page, '13'); await waitPair(page, 'dashBranchDetail', 2);
  await selectDash(page, '01'); await waitSingle(page, 'dashBranchDetail', '01');
  await selectDash(page, '13T'); await page.waitForFunction(() => document.getElementById('dashBranchDetail').dataset.branchCode === '13T', null, { timeout: 8000 });
  await waitPair(page, 'dashBranchDetail', 2);
  const before = await readPair(page, 'dashBranchDetail');
  const n0 = await wlen(page);
  await page.evaluate(() => {
    window.__sawLoading = false;
    const el = document.getElementById('dashBranchDetail');
    window.__mo = new MutationObserver(() => { if(el.className === 'loading' || /^กำลังโหลด/.test(el.textContent.trim())) window.__sawLoading = true; });
    window.__mo.observe(el, { attributes: true, childList: true });
    const box = document.getElementById('dashBranchDetail__part_0');
    box.querySelector('[data-quickpay="2026-11-18"]').click();
    document.getElementById('quickpaydate-13-2026-11-18').value = '2026-11-19';
    box.querySelector('[data-quickpayconfirm="2026-11-18"]').click();
  });
  await page.waitForFunction(() => window.__store['day:2026-11-18'].billingPaid['13'], null, { timeout: 8000 });
  await page.waitForFunction(() => { const b = document.querySelector('#dashBranchDetail__part_0 [data-quickpay="2026-11-18"]'); return b && b.classList.contains('paid'); }, null, { timeout: 10000 });
  await waitPair(page, 'dashBranchDetail', 2);
  const after = await readPair(page, 'dashBranchDetail');
  const E2 = await page.evaluate(() => window.__expGroup(['13', '13T']));
  const w1 = await writesSince(page, n0);
  const dw1 = dayWrites(w1);
  check('B: ติ๊กจ่ายกล่อง 13 → เขียน patchField day:2026-11-18 ["billingPaid","13"] ครั้งเดียว', dw1.length === 1 && dw1[0].op === 'patchField' && dw1[0].key === 'day:2026-11-18' && JSON.stringify(dw1[0].path) === '["billingPaid","13"]', dw1);
  check('B: ไม่มี set ทั้งวัน/ไม่แตะ rawLots/settings', !w1.some(w => w.op === 'set' || w.key === 'rawLots' || w.key === 'settings'), w1.map(w => w.op + ':' + w.key));
  const paid13 = await page.evaluate(() => window.__store['day:2026-11-18'].billingPaid);
  check('B: 13T วันเดียวกันยังไม่ถูกติ๊ก', !paid13['13T'] && paid13['13'] && paid13['13'].paidDate === '2026-11-19', paid13);
  check('B: กล่อง 13T ไม่ขยับ (ตัวเลข + จำนวนแถว)', JSON.stringify(after.parts[1].kpi) === JSON.stringify(before.parts[1].kpi) && after.parts[1].rows === before.parts[1].rows, { b: before.parts[1], a: after.parts[1] });
  check('B: แถวรวมหลังจ่าย = ค่าจริงใหม่', num(after.totals.unpaidCount) === E2.unpaidCount && num(after.totals.unpaidTotal) === Math.round(E2.unpaidTotal) && E2.unpaidCount === E1.unpaidCount - 1, { shown: after.totals, exp: E2 });
  const flash = await page.evaluate(() => { window.__mo.disconnect(); return window.__sawLoading; });
  check('B: รีเฟรชหลังจ่ายไม่ขึ้น "กำลังโหลด…" ที่ container + ไม่เด้งสาขา (ยังเป็น 13T)', !flash && after.code === '13T' && after.cls === '' && (await page.evaluate(() => document.getElementById('dashBranchSelect').value)) === '13T', { flash, code: after.code });
  await selectDash(page, '01'); await waitSingle(page, 'dashBranchDetail', '01');
  const S01 = await readPair(page, 'dashBranchDetail');
  const E01 = await page.evaluate(() => window.__expGroup(['01']));
  check('B: สลับไปการ์ด 01 ไม่มีแถวรวมโผล่ และตัวเลข 01 ถูก', !S01.has && S01.totals.unpaidTotal === null && num(S01.text.match(/ยอดค้างโอน\s*([^\s]+)/)[1]) === Math.round(E01.unpaidTotal), S01.totals);

  // ---------- D/B: การ์ดคู่ในหน้ารวม (ตัวกรองสาขา) — แพตช์ในที่ ----------
  await page.evaluate(async () => { await switchTab('billing'); });
  await stripBanner(page);
  await page.selectOption('#outstandingBranchFilter', '13');
  await waitPair(page, 'outstandingBranchDetail', 2);
  await page.selectOption('#outstandingBranchFilter', '02');
  await waitSingle(page, 'outstandingBranchDetail', '02');
  await page.selectOption('#outstandingBranchFilter', '13T');
  await page.waitForFunction(() => document.getElementById('outstandingBranchDetail').dataset.branchCode === '13T', null, { timeout: 8000 });
  await waitPair(page, 'outstandingBranchDetail', 2);
  const ob = await readPair(page, 'outstandingBranchDetail');
  const CH = '2026-11-18';
  const n1 = await wlen(page);
  await page.evaluate(() => {
    const p0 = document.getElementById('outstandingBranchDetail__part_0'), p1 = document.getElementById('outstandingBranchDetail__part_1');
    p0.querySelector('[data-quickpay="2026-11-19"]').click();              // เปิดช่องของกล่อง 13 ค้างไว้
    p1.querySelector('[data-quickpay="2026-11-19"]').click();
    document.getElementById('quickpaydate-13T-2026-11-19').value = '2026-11-18';
    p1.querySelector('[data-quickpayconfirm="2026-11-19"]').click();
  });
  await page.waitForFunction(() => window.__store['day:2026-11-19'].billingPaid['13T'], null, { timeout: 8000 });
  await page.waitForFunction(() => { const b = document.querySelector('#outstandingBranchDetail__part_1 [data-quickpay="2026-11-19"]'); return b && b.classList.contains('paid'); }, null, { timeout: 8000 });
  const oa = await readPair(page, 'outstandingBranchDetail');
  const E3 = await page.evaluate(() => window.__expGroup(['13', '13T']));
  const dw2 = dayWrites(await writesSince(page, n1));
  check('D: ติ๊กจ่ายกล่อง 13T → patchField day:2026-11-19 ["billingPaid","13T"] อย่างเดียว', dw2.length === 1 && dw2[0].op === 'patchField' && dw2[0].key === 'day:2026-11-19' && JSON.stringify(dw2[0].path) === '["billingPaid","13T"]', dw2);
  check('D: บิล 13 วันเดียวกันยังไม่จ่าย', !(await page.evaluate(() => window.__store['day:2026-11-19'].billingPaid['13'])));
  check('D: กล่อง 13 ไม่ขยับ (ตัวเลข + จำนวนแถว)', JSON.stringify(oa.parts[0].kpi) === JSON.stringify(ob.parts[0].kpi) && oa.parts[0].rows === ob.parts[0].rows, { b: ob.parts[0], a: oa.parts[0] });
  check('D: แถวรวม (แพตช์ในที่ ไม่รีโหลด) = ค่าจริงใหม่', num(oa.totals.unpaidCount) === E3.unpaidCount && num(oa.totals.unpaidTotal) === Math.round(E3.unpaidTotal), { shown: oa.totals, exp: E3 });
  const lock = await page.evaluate(() => ({ q: document.getElementById('quickpaydate-13-2026-11-19').value, q2: (document.getElementById('quickpaydate-13-2026-11-20') || {}).value,
    bar: Array.from(document.querySelectorAll('#outstandingBranchDetail__part_0 input#branchPayDate')).map(i => i.value), last: lastUsedPayDate }));
  check('D: ล็อกวันจ่ายข้ามกล่อง: ช่องวันที่ในกล่อง 13 (ทีละบิล + โอนรวม) = วันที่เพิ่งยืนยัน', lock.q === CH && lock.q2 === CH && lock.bar.length === 1 && lock.bar[0] === CH && lock.last === CH, lock);

  // โอนรวม: เลือกบิลในทั้งสองกล่อง → แถบของกล่อง 13 นับเฉพาะของตัวเอง และยืนยันแล้วเขียนแค่ 13
  const n2 = await wlen(page);
  const bar = await page.evaluate(() => {
    const p0 = document.getElementById('outstandingBranchDetail__part_0'), p1 = document.getElementById('outstandingBranchDetail__part_1');
    const c0 = p0.querySelector('[data-billselect="2026-11-20"]'), c1 = p1.querySelector('[data-billselect="2026-11-20"]');
    c0.checked = true; c0.dispatchEvent(new Event('change')); c1.checked = true; c1.dispatchEvent(new Event('change'));
    return { n0: p0.querySelector('#branchPaySelCount').textContent, s0: p0.querySelector('#branchPaySelSum').textContent, n1: p1.querySelector('#branchPaySelCount').textContent };
  });
  const a13 = await page.evaluate(() => { const d = normalizeDay_(JSON.parse(JSON.stringify(window.__store['day:2026-11-20']))); return branchBillAmount(d.orders['13'], '2026-11-20', d, '13'); });
  check('D: แถบโอนรวมกล่อง 13 นับแค่บิล 13 (1 บิล ยอดของ 13 เท่านั้น)', bar.n0 === '1' && num(bar.s0) === Math.round(a13) && bar.n1 === '1', bar);
  await page.click('#outstandingBranchDetail__part_0 #branchPayConfirmBtn');
  await page.waitForFunction(() => window.__store['day:2026-11-20'].billingPaid['13'], null, { timeout: 8000 });
  await waitPair(page, 'outstandingBranchDetail', 2);
  const dw3 = dayWrites(await writesSince(page, n2));
  const p20 = await page.evaluate(() => window.__store['day:2026-11-20'].billingPaid);
  check('D: โอนรวมจากกล่อง 13 เขียนแค่ ["billingPaid","13"] ของ 20/11 — 13T ไม่ถูกติ๊กข้ามกล่อง', dw3.length === 1 && JSON.stringify(dw3[0].path) === '["billingPaid","13"]' && dw3[0].key === 'day:2026-11-20' && !p20['13T'], { dw3, p20 });

  // ---------- Brand fee ก่อน = หลัง + ไม่มีการเขียนที่ไม่ควรเกิด ----------
  const feeAfter = await page.evaluate(() => Object.fromEntries(Object.keys(window.__store).filter(k => k.startsWith('day:')).map(k => { const d = normalizeDay_(JSON.parse(JSON.stringify(window.__store[k]))); return [k, computeFeeTotals(d.orders, d)]; })));
  check('Brand fee (computeFeeTotals) ทุกวัน ก่อน = หลังเป๊ะ', JSON.stringify(feeAfter) === JSON.stringify(A.fee), { before: A.fee, after: feeAfter });
  const allW = await page.evaluate(() => window.__writes.map(w => ({ op: w.op, key: w.key, path: w.path })));
  check('ทั้งเทส (หลังรีโหลด): ไม่มี set เลย, ไม่แตะ rawLots/settings/wasteRecords, day: มีแค่ billingPaid', !allW.some(w => w.op === 'set') && !allW.some(w => ['rawLots', 'settings', 'wasteRecords'].includes(w.key)) && allW.filter(w => w.key.startsWith('day:')).every(w => w.op === 'patchField' && w.path[0] === 'billingPaid'), allW);
  await page.close();

  // ---------- 01 / 1 / 1T: จับคู่ผลเดียวกันทั้งสองทาง + escapeHtml ----------
  const q = await openApp(browser, { store: { rawLots: [],
    'day:2026-11-19': mkDay({ orders: { '01': { p1: 1 }, '1': { p1: 2 }, '1T': { p1: 3 } } }),
    ['day:' + TODAY]: mkDay({ orders: { '13': { p1: 1 }, '13T': { p1: 1 } } }) }, date: TODAY });
  await q.clock.setFixedTime(new Date(TODAY + 'T10:00:00+07:00'));
  const G = await q.evaluate(async () => {
    settings.branches.push({ code: '1', area: 'ทดสอบหนึ่ง' }, { code: '1T', area: '', label: 'สาขา 1(แยกส่ง)', separate: true });
    const agg = await computeBranchAggregates();
    const r = { p01: branchPairParts_('01', agg), p1: branchPairParts_('1', agg), p1T: branchPairParts_('1T', agg),
      sym: [branchSameGroup_('01', '1T'), branchSameGroup_('1T', '01'), branchSameGroup_('01', '1'), branchSameGroup_('1', '01')] };
    settings.branches.find(b => b.code === '1T').separate = false;
    r.noSep = [branchSameGroup_('01', '1'), branchSameGroup_('1', '01'), branchPairParts_('01', agg).join()];
    settings.branches.find(b => b.code === '1T').separate = true;
    return r;
  });
  check('01/1/1T: เปิดจาก 01, 1 หรือ 1T ได้ชุดเดียวกัน', G.p01.join() === G.p1.join() && G.p1.join() === G.p1T.join() && G.p01.length === 3 && G.p01[2] === '1T', G);
  check('01/1/1T: branchSameGroup_ สมมาตร', G.sym.every(Boolean), G.sym);
  check('01 กับ 1 (ไม่มีสาขาแยกส่งเลขนั้น) ไม่ถูกจับคู่', G.noSep[0] === false && G.noSep[1] === false && G.noSep[2] === '01', G.noSep);
  // ชื่อสาขามี HTML/เครื่องหมายคำพูด
  await q.evaluate(() => {
    window.__xss = 0;
    settings.branches.find(b => b.code === '13').label = '<img src=x onerror="window.__xss=1"><b id="inj">X</b>"q';
    settings.branches.push({ code: '13T', area: '', label: '<b id="inj2">T</b>"', separate: true });
    populateDashBranchSelect();
    renderBillingList();
    const s = document.getElementById('dashBranchSelect'); s.value = '13'; s.dispatchEvent(new Event('change'));
  });
  await waitPair(q, 'dashBranchDetail', 2);
  await q.waitForTimeout(200);
  const X = await q.evaluate(() => ({ inj: !!document.querySelector('#inj, #inj2, #dashBranchDetail img, #billingList img'), xss: window.__xss,
    head: document.querySelector('#dashBranchDetail .branchpair-head').textContent, row: document.querySelector('#bb-13 .n').textContent }));
  check('escapeHtml: ชื่อสาขามี <b>/<img>/" ไม่ถูกฉีดเป็น HTML ทั้งหัวการ์ดคู่และบิลรายวัน', !X.inj && !X.xss && X.head.includes('<b id="inj">X</b>"q') && X.row.includes('<b id="inj">'), X);
  await q.close();

  await finish(browser);
})();
