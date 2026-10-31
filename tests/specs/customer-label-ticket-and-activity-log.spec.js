const { launch, mkDay, openApp, makeChecker } = require('../helpers');

// สาขาที่ตั้ง "ป้ายชื่อกำหนดเอง" (เช่น ลูกค้ารหัส KT) ป้าย PeriPage ไม่ขึ้นคำว่า "สาขา" นำหน้า, สาขาปกติยังขึ้นเหมือนเดิม
// กิจกรรมล่าสุด: เพิ่มสาขามีวันที่, บันทึก/แก้/ลบออเดอร์, รับชำระบิล/กลับเป็นรอโอน, แก้ข้อมูลสาขา, ตั้งราคา ถูกบันทึก
// และแดชบอร์ดโหลด log ใหม่จากเซิร์ฟเวอร์ (เห็นกิจกรรมจากเครื่องอื่น)
(async () => {
  const browser = await launch();
  const { check, finish } = makeChecker();
  const iso = '2026-10-20';
  const page = await openApp(browser, {
    store: { ['day:' + iso]: mkDay({ orders: { '11': { p1: 2 } } }), activityLog: [] },
    date: iso,
  });
  await page.evaluate(() => { settings.priceHistory = {}; PRODUCTS.forEach(p => { settings.priceHistory[p.id] = [{ date: '2026-01-01', price: 100 }]; }); window.__store.settings = JSON.parse(JSON.stringify(settings)); });
  const log = () => page.evaluate(() => (window.__store.activityLog || []).map(e => e.text));
  const settle = () => page.evaluate(() => activityLogQueue_);

  // --- PeriPage ticket ---
  const tk = await page.evaluate(() => {
    settings.branches.push({ code: 'KT', area: 'ลูกค้า', label: 'คุณสมชาย', separate: true, billName: '', billAddr: '', billTax: '' });
    const html = code => { const d = document.createElement('div'); d.innerHTML = buildOrderTicketHTML(code, '2026-10-20', { p1: 1 }); return d; };
    const kt = html('KT'), b11 = html('11');
    return {
      ktSaxa: !!kt.querySelector('.orderticket-saxa'), ktName: kt.querySelector('.orderticket-name').textContent,
      ktCode: kt.querySelector('.orderticket-code').textContent, b11Saxa: (b11.querySelector('.orderticket-saxa') || {}).textContent,
    };
  });
  check('Labelled branch (customer KT): no "สาขา" on PeriPage ticket', !tk.ktSaxa, tk);
  check('Labelled branch shows the custom name and its code', tk.ktName === 'คุณสมชาย' && tk.ktCode === 'KT', tk);
  check('Normal branch still shows "สาขา"', tk.b11Saxa === 'สาขา', tk);

  // --- add branch has a date ---
  await page.evaluate(async () => {
    renderBranchSettings();
    document.getElementById('newBranchCode').value = '30';
    document.getElementById('newBranchArea').value = 'ทดสอบ';
    await addBranch();
  });
  await settle();
  const today = await page.evaluate(() => formatDDMMYYYY(todayISO()));
  let l = await log();
  check('Add branch log includes the date', l.some(t => t === `เพิ่มสาขา 30 ทดสอบ — วันที่ ${today}`), l);
  const addCount = l.length;

  // --- branch edit is logged once with what changed; a no-op save logs nothing ---
  await page.evaluate(async () => {
    const i = settings.branches.findIndex(b => b.code === '30');
    document.querySelector(`[data-blabel="${i}"]`).value = 'คุณสมหญิง';
    document.querySelector(`[data-bbillname="${i}"]`).value = 'สมหญิง ใจดี';
    await saveBranches({ silent: true });
    await saveBranches({ silent: true });
  });
  await settle();
  l = await log();
  const edits = l.filter(t => t.startsWith('แก้ไขสาขา 30'));
  check('Branch edit logged once (second identical save adds nothing)', edits.length === 1 && l.length === addCount + 1, l);
  check('Branch edit log names the changed fields and date',
    /ป้ายชื่อ: \(ว่าง\) → คุณสมหญิง/.test(edits[0] || '') && /ชื่อผู้ซื้อ: \(ว่าง\) → สมหญิง ใจดี/.test(edits[0] || '') && (edits[0] || '').endsWith(`วันที่ ${today}`), edits);

  // --- ticking "แยกส่ง" in the branch list is logged ---
  await page.evaluate(async () => {
    const i = settings.branches.findIndex(b => b.code === '30');
    const cb = document.querySelector(`[data-bsep="${i}"]`);
    cb.checked = true;
    cb.dispatchEvent(new Event('change'));
  });
  await page.waitForFunction(() => (window.__store.activityLog || []).some(e => e.text.includes('ติ๊ก แยกส่ง')), null, { timeout: 5000 }).catch(() => {});
  l = await log();
  const sepTick = await page.evaluate(() => settings.branches.find(b => b.code === '30').separate);
  check('Ticking แยกส่ง is saved and logged', sepTick === true && l.some(t => t.startsWith('แก้ไขสาขา 30 — ติ๊ก แยกส่ง')), l);

  // --- order save / edit / delete ---
  await page.evaluate(async () => {
    await switchTab('order');
    document.getElementById('branchSelect').value = '12';
    renderProductInputs();
    document.querySelector('.prodinput[data-pid="p1"]').value = '3';
    await saveRow();
    document.getElementById('branchSelect').value = '12';
    renderProductInputs();
    document.querySelector('.prodinput[data-pid="p1"]').value = '4';
    await saveRow();
  });
  await settle();
  l = await log();
  check('New order logged with branch and date', l.some(t => t.startsWith('บันทึกออเดอร์ สาขา 12 ') && t.endsWith('วันที่ 20/10/2026')), l);
  check('Re-saving an order logs as an edit', l.some(t => t.startsWith('แก้ไขออเดอร์ สาขา 12 ') && t.endsWith('วันที่ 20/10/2026')), l);

  page.once('dialog', d => d.accept());
  await page.click('#orderList [data-del="12"]');
  await page.waitForFunction(() => (window.__store.activityLog || []).some(e => e.text.startsWith('ลบออเดอร์ สาขา 12 ')), null, { timeout: 5000 }).catch(() => {});
  l = await log();
  check('Deleting an order is logged', l.some(t => t.startsWith('ลบออเดอร์ สาขา 12 ') && t.endsWith('วันที่ 20/10/2026')), l);

  // --- bill paid / back to unpaid ---
  await page.evaluate(async () => {
    await writeBillingPaid_('2026-10-20', '11', { paid: true, paidDate: '2026-10-21', transferAmount: 500, billedAmount: 500 });
    await writeBillingPaid_('2026-10-20', '11', false);
  });
  await settle();
  l = await log();
  check('Paid bill logged with amount, bill date and transfer date',
    l.some(t => t.startsWith('รับชำระบิล สาขา 11 ') && t.includes('฿500') && t.includes('บิลวันที่ 20/10/2026') && t.includes('โอนวันที่ 21/10/2026')), l);
  check('Back-to-unpaid logged', l.some(t => t.startsWith('เปลี่ยนบิล สาขา 11 ') && t.includes('กลับเป็นรอโอน')), l);

  // --- price ---
  await page.evaluate(async () => {
    renderPriceProductSelect();
    document.getElementById('priceProductSelect').value = 'p1';
    document.getElementById('newPriceDate').value = '2026-11-01';
    document.getElementById('newPriceValue').value = '250';
    await addPriceHistory();
  });
  await settle();
  l = await log();
  check('Price change logged with effective date', l.some(t => t.startsWith('ตั้งราคา ') && t.includes('฿250') && t.endsWith('มีผลวันที่ 01/11/2026')), l);

  // --- dashboard reloads the log (entries written by another device show up) ---
  const fresh = await page.evaluate(async () => {
    window.__store.activityLog.push({ id: 'other', ts: Date.now(), text: 'จากเครื่องอื่น' });
    await loadActivityLog({ fresh: true });
    renderActivityFeed_();
    return document.getElementById('dashActivityFeed').textContent.includes('จากเครื่องอื่น');
  });
  check('Fresh load picks up entries written elsewhere', fresh);

  await finish(browser);
})();
