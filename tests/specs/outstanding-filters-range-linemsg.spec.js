const { launch, mkDay, openApp, makeChecker } = require('../helpers');

// รายการที่ต้องตามโอน: ฟิลเตอร์ประเภทบิล (แยกส่งเท่านั้น), ช่วงหลายเดือน, สาขาแยกส่งอยู่ท้ายสุดของแต่ละวัน,
// กดโอนแล้ว→รอโอนแพตช์แค่แถวเดียว (ไม่โหลดทั้งลิสต์), การ์ดที่เช็คแล้วพับ/กางได้, ข้อความทวงยอด Line แยกสาขา
(async () => {
  const browser = await launch();
  const { check, finish } = makeChecker();
  const store = {
    'day:2026-09-15': mkDay({ orders: { '01': { p1: 2 } }, billingPaid: { '01': { paid: true, paidDate: '2026-09-16', transferAmount: 550, billedAmount: 550 } } }),
    'day:2026-10-05': mkDay({ orders: { '13S': { p1: 2 }, '13': { p1: 3 }, '01': { p1: 1 } }, billingPaid: { '01': { paid: true, paidDate: '2026-10-06', transferAmount: 275, billedAmount: 275 } } }),
    'day:2026-10-07': mkDay({ orders: { '13': { p1: 1 } } }),
  };
  const page = await openApp(browser, { store, date: '2026-10-08', viewport: { width: 420, height: 1600 } });
  await page.evaluate(() => {
    window.__listCalls = 0;
    const orig = window.storage.list;
    window.storage.list = async (...a) => { window.__listCalls++; return orig(...a); };
  });
  await page.evaluate(async () => { await switchTab('billing'); });
  await page.waitForTimeout(500);
  const keys = () => page.evaluate(() => Array.from(document.querySelectorAll('#outstandingList [data-outstandingrow]')).map(r => r.getAttribute('data-outstandingrow')));

  // ===== สาขาแยกส่ง (13S) อยู่ท้ายสุดของวันเดียวกัน แม้รหัสจะเรียงก่อน =====
  await page.click('#outstandingDateSortToggle'); // ล่าสุด→เก่าสุด
  await page.waitForTimeout(300);
  await page.click('#outstandingDateSortToggle'); // เก่าสุด→ล่าสุด
  await page.waitForTimeout(400);
  let k = await keys();
  check('Unpaid rows by date, separate-send 13S after main 13 on the same day', JSON.stringify(k) === JSON.stringify(['2026-10-05|13', '2026-10-05|13S', '2026-10-07|13']), k);

  // ===== ฟิลเตอร์ "แยกส่งเท่านั้น" / "บิลหลัก" =====
  await page.click('[data-outtypefilter="sep"]');
  await page.waitForTimeout(400);
  k = await keys();
  check('"แยกส่งเท่านั้น" shows only the 13S bill', JSON.stringify(k) === JSON.stringify(['2026-10-05|13S']), k);
  await page.click('[data-outtypefilter="main"]');
  await page.waitForTimeout(400);
  k = await keys();
  check('"บิลหลัก" hides the 13S bill', k.length === 2 && !k.some(x => x.endsWith('13S')), k);
  await page.click('[data-outtypefilter="all"]');
  await page.waitForTimeout(300);

  // ===== ช่วงหลายเดือน (ก.ย.–ต.ค.) ในฟิลเตอร์ "โอนแล้ว" =====
  await page.click('[data-outstatusfilter="paid"]');
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const from = document.getElementById('outstandingMonthInput'); from.value = '2026-10'; from.dispatchEvent(new Event('change'));
  });
  await page.waitForTimeout(300);
  k = await keys();
  check('Paid filter, October only -> 1 paid bill', JSON.stringify(k) === JSON.stringify(['2026-10-05|01']), k);
  await page.evaluate(() => {
    const from = document.getElementById('outstandingMonthInput'); from.value = '2026-09'; from.dispatchEvent(new Event('change'));
  });
  await page.waitForTimeout(400);
  k = await keys();
  check('Paid filter, September→October range -> both paid bills from 2 months', k.length === 2 && k.includes('2026-09-15|01') && k.includes('2026-10-05|01'), k);

  // ===== โอนแล้ว → รอโอน: แพตช์แถวเดียว ไม่ list ใหม่ แถวอื่นยังเป็น DOM เดิม =====
  await page.click('[data-outstatusfilter="all"]');
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    document.querySelector('[data-outstandingrow="2026-10-07|13"]').dataset.marker = 'keep';
    window.__listCalls = 0;
    window.confirm = () => true;
  });
  await page.click('[data-outstandingpay="2026-10-05|01"]');
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({
    listCalls: window.__listCalls,
    markerKept: document.querySelector('[data-outstandingrow="2026-10-07|13"]').dataset.marker === 'keep',
    btnText: document.querySelector('[data-outstandingpay="2026-10-05|01"]').textContent.trim(),
    stored: window.__store['day:2026-10-05'].billingPaid['01'],
    loading: !!document.querySelector('#outstandingList .loading'),
  }));
  check('Paid→pending does not re-list all days (no full reload)', after.listCalls === 0, after.listCalls);
  check('Other rows keep their DOM node (only this row was patched)', after.markerKept);
  check('Row now shows รอโอน', after.btnText === 'รอโอน', after.btnText);
  check('billingPaid cleared in storage', !after.stored, after.stored);
  check('No loading placeholder shown', !after.loading);

  // ===== โหมดรีเช็ค: ปุ่ม 🔎 CHECK หน้าสุด, เช็คแล้วพับแคบ แตะกางได้ =====
  await page.evaluate(() => { const cb = document.getElementById('recheckModeToggle'); cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(500);
  const firstIsCheck = await page.evaluate(() => {
    const row = document.querySelector('[data-outstandingrow="2026-10-07|13"]');
    const first = row.querySelector('.toprow').firstElementChild;
    return first && first.hasAttribute('data-recheckstart') && first.textContent.includes('CHECK');
  });
  check('Square 🔎 CHECK button is the first thing in the row', firstIsCheck);
  await page.click('[data-outstandingrow="2026-10-07|13"] [data-recheckstart]');
  await page.click('[data-outstandingrow="2026-10-07|13"] [data-recheckresult="still_unpaid"]');
  await page.waitForTimeout(400);
  const hBefore = await page.evaluate(() => document.querySelector('[data-outstandingrow="2026-10-05|13"]').getBoundingClientRect().height);
  const checkedState = await page.evaluate(() => {
    const row = document.querySelector('[data-outstandingrow="2026-10-07|13"]');
    return { checked: row.classList.contains('checked'), h: row.getBoundingClientRect().height, detailShown: getComputedStyle(row.querySelector('.ochkdetail')).display !== 'none' };
  });
  check('Checked row gets the collapsed "checked" style', checkedState.checked, checkedState);
  check('Checked row is shorter than an unchecked row', checkedState.h < hBefore, { checked: checkedState.h, unchecked: hBefore });
  check('Check details hidden while collapsed', !checkedState.detailShown);
  await page.click('[data-outstandingrow="2026-10-07|13"] .left');
  await page.waitForTimeout(150);
  const expanded = await page.evaluate(() => {
    const row = document.querySelector('[data-outstandingrow="2026-10-07|13"]');
    return { expanded: row.classList.contains('expanded'), detailShown: getComputedStyle(row.querySelector('.ochkdetail')).display !== 'none' };
  });
  check('Tapping a checked row expands it and shows the check details', expanded.expanded && expanded.detailShown, expanded);
  const viewTabs = await page.evaluate(() => Array.from(document.querySelectorAll('[data-recheckview]')).map(b => b.textContent.trim()));
  check('Recheck view filter tabs exist (ทุกบิล/ยังไม่เช็ค/เช็คแล้ว)', viewTabs.length === 3, viewTabs);
  await page.click('[data-recheckview="checked"]');
  await page.waitForTimeout(400);
  k = await keys();
  check('"เช็คแล้ว" view shows only the checked bill', JSON.stringify(k) === JSON.stringify(['2026-10-07|13']), k);
  check('Bottom save-and-clear button is present in recheck mode', await page.evaluate(() => !!document.querySelector('[data-recheckclearbottom]')));

  // ===== ข้อความทวงยอด Line: 13 กับ 13S อยู่ข้อความเดียว แบ่ง 2 ส่วน ปกติก่อน > แยกส่ง =====
  await page.click('#outstandingLineMsgBtn');
  await page.waitForTimeout(500);
  const msgs = await page.evaluate(() => Array.from(document.querySelectorAll('[data-linemsgtext]')).map(e => e.textContent));
  const m13 = msgs.find(t => t.includes('บิลแยกส่ง'));
  console.log('Line messages:\n' + msgs.join('\n-----\n'));
  check('One combined message for 13 + 13S', !!m13 && msgs.filter(t => t.includes('บิลแยกส่ง')).length === 1, msgs.length);
  check('Normal section comes before the แยกส่ง section', m13 && m13.indexOf('บิลปกติ') !== -1 && m13.indexOf('บิลปกติ') < m13.indexOf('บิลแยกส่ง'), m13);
  check('Greeting and closing lines present', m13 && m13.startsWith('สวัสดีค่ะ จากบัญชีก้ามโตนะคะ') && m13.includes('พอดีเช็คในไลน์กลุ่มไม่มีสลิปส่งมาค่ะ รบกวนด้วยนะคะ 🙏🏻🥹'), m13);
  check('Normal section lists 13\'s two dates with total', m13 && m13.includes('05/10/2026') && m13.includes('07/10/2026') && m13.includes('รวมบิลปกติ 1,100 บาท'), m13);
  check('Grand total line present', m13 && m13.includes('รวมทั้งหมด 1,650 บาท'), m13);
  const m01 = msgs.find(t => t.includes('จำนวน 275 บาทค่ะ'));
  check('Single-bill branch gets the one-sentence form (01, 05/10, ฿275 — just set back to รอโอน)', !!m01 && m01.includes('วันที่ 05/10/2026'), msgs);

  await finish(browser);
})();
