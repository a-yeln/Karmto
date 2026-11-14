const path = require('path');
const { launch, mkDay, openApp, makeChecker, stripBanner } = require('../helpers');

// ร่างออเดอร์จาก LINE (lineOrders:YYYY-MM-DD) ในหน้าออเดอร์ + จำผู้โอน↔สาขา (slipPayers) ในการ์ดจับคู่ยอดโอน
// กฎเหล็ก: แตะร่าง = เติมฟอร์มเท่านั้น ไม่บันทึกออเดอร์; ความจำผู้โอนจดเฉพาะหลัง AY กดยืนยันติ๊กจ่ายเอง และแค่ติดป้ายบอก ไม่เลือกบิลให้
const TODAY = '2026-11-14';
const SHOT_DIR = process.env.SHOT_DIR || path.join(__dirname, '..', 'screenshots');
const bill = amt => ({ custom: [{ name: 'ของ', qty: 1, price: amt }] });

function seedStore(){
  return {
    ['day:' + TODAY]: mkDay({ orders: { '01': bill(1250), '02': bill(1250), '09': { p1: 2 } } }),
    ['day:2026-11-13']: mkDay({ orders: { '01': bill(700) } }),
    ['lineOrders:' + TODAY]: [
      { id: 'H1', type: 'order', at: TODAY + 'T09:10:00', postedBy: 'น้องเอ', via: 'intake', text: 'สาขา 5 บางนา\nBm9 กุ้งแช่ (กก.) 3\nBm9 ปูจืด (กก.) 2\nเนื้อหอยนางรม (กระปุก) 10' },
      { id: 'H2', type: 'order', at: TODAY + 'T09:20:00', postedBy: '<img src=x onerror=window.__xss=1>', via: 'intake', text: 'สาขา 9 xx\nกุ้งดอง (กก.) 4' },
      { id: 'H3', type: 'order', at: TODAY + 'T09:30:00', postedBy: 'ใครไม่รู้', text: 'สวัสดีตอนเช้า\nไม่มีอะไร' },
      { id: 'H4', type: 'order', at: TODAY + 'T09:40:00', postedBy: 'ซ่อนแล้ว', text: 'สาขา 3\nกุ้งแช่ (กก.) 1', dismissed: true },
      { id: 'H5', type: 'slip', at: TODAY + 'T09:50:00', text: 'สาขา 4\nกุ้งแช่ (กก.) 1' },
    ],
    ['lineOrders:2026-11-10']: [{ id: 'H9', type: 'order', at: '2026-11-10T09:00:00', text: 'สาขา 7\nกุ้งแช่ (กก.) 1' }],
    ['lineInbox:' + TODAY]: [
      { id: 'L1', type: 'slip', at: TODAY + 'T10:21:00', amount: 1250, slipDate: TODAY, slipTime: '10:21', sender: 'นาย สมชาย ใจดี', senderAcct: 'xxx-x-x1234-x', postedBy: 'สาขา 2' },
      { id: 'L2', type: 'slip', at: TODAY + 'T11:00:00', amount: 700, slipDate: TODAY, slipTime: '11:00', sender: 'นาย  สมชาย ใจดี', senderAcct: 'XXX-X-X1234-X', postedBy: 'สาขา 2' },
      { id: 'L3', type: 'slip', at: TODAY + 'T11:30:00', amount: 700, slipDate: TODAY, slipTime: '11:30', sender: 'นาง คนอื่น', senderAcct: 'xxx-x-x9999-x' },
    ],
  };
}

(async () => {
  const browser = await launch();
  const { check, finish } = makeChecker();
  const page = await openApp(browser, { store: seedStore(), date: TODAY });
  await page.clock.setFixedTime(new Date(TODAY + 'T12:00:00+07:00'));
  await page.evaluate(async () => { await switchTab('order'); });
  await stripBanner(page);
  await page.waitForSelector('#lineOrderDrafts [data-lod]', { timeout: 8000 });
  await page.evaluate(() => { window.__writes = []; });

  // ============ A) ร่างออเดอร์ ============
  const chips = await page.evaluate(() => Array.from(document.querySelectorAll('#lineOrderDrafts [data-lod]')).map(b => b.dataset.lod + '|' + b.textContent.replace(/\s+/g, ' ').trim()));
  check('โชว์เฉพาะร่างออเดอร์ 2 วันล่าสุดที่อ่านได้ ไม่ซ่อน ใหม่สุดก่อน (H2,H1)', chips.map(c => c.split('|')[0]).join(',') === 'H2,H1', chips);
  check('ชิปบอกสาขา + จำนวนรายการ + เวลา + ผู้ส่ง', /05|5/.test(chips[1]) && /3 รายการ/.test(chips[1]) && /09:10/.test(chips[1]) && /น้องเอ/.test(chips[1]), chips[1]);
  check('สาขาที่มีออเดอร์อยู่แล้ววันนี้ติดป้าย ✓ มีออเดอร์แล้ว', /มีออเดอร์แล้ว/.test(chips[0]) && !/มีออเดอร์แล้ว/.test(chips[1]), chips);
  check('ชื่อผู้ส่งที่เป็นโค้ดไม่ถูกรัน (escape)', await page.evaluate(() => !window.__xss && !document.querySelector('#lineOrderDrafts img')));

  await page.click('[data-lod="H1"]');
  await page.waitForTimeout(400);
  const form = await page.evaluate(() => ({
    branch: document.getElementById('branchSelect').value,
    p1: (document.querySelector('.prodinput[data-pid="p1"]') || {}).value, p4: (document.querySelector('.prodinput[data-pid="p4"]') || {}).value, p7: (document.querySelector('.prodinput[data-pid="p7"]') || {}).value,
    status: document.getElementById('orderImageStatus').textContent,
    saved: JSON.stringify(window.__store['day:2026-11-14'].orders['05'] || null), mem: JSON.stringify(dayData.orders['05'] || null),
  }));
  check('แตะร่าง → เลือกสาขา 05 + เติม กุ้งแช่ 3 / ปูจืด 2 / นางรม 10 ในฟอร์ม', form.branch === '05' && form.p1 === '3' && form.p4 === '2' && form.p7 === '10', form);
  check('ข้อความบอกว่าเป็นร่างจาก LINE + ให้ตรวจก่อนบันทึก', /ร่างจาก LINE/.test(form.status) && /ตรวจสอบ/.test(form.status), form.status);
  check('แตะร่างไม่บันทึกออเดอร์ (ไม่มีการเขียน, ข้อมูลวันไม่เปลี่ยน)', (await page.evaluate(() => window.__writes.length)) === 0 && form.saved === 'null' && form.mem === 'null', form);

  await page.click('[data-lod="H2"]');
  await page.waitForTimeout(400);
  const warn = await page.evaluate(() => ({ html: document.getElementById('orderImageStatus').textContent, order: JSON.stringify(window.__store['day:2026-11-14'].orders['09']) }));
  check('สาขาที่มีออเดอร์แล้ว → เตือนว่าจะเขียนทับ และของเดิมยังอยู่', /มีออเดอร์บันทึกไว้แล้ว/.test(warn.html) && warn.order === '{"p1":2}', warn);
  check('ยังไม่มีการเขียนใดๆ', (await page.evaluate(() => window.__writes.length)) === 0);
  await page.screenshot({ path: path.join(SHOT_DIR, 'line-order-drafts.png'), clip: { x: 0, y: 0, width: 420, height: 700 } }).catch(() => {});
  check('แถบร่างไม่ล้นจอ 420px', await page.evaluate(() => document.documentElement.scrollWidth <= 420));

  await page.click('[data-lodx="H2"]');
  await page.waitForFunction(() => !document.querySelector('[data-lod="H2"]'), null, { timeout: 5000 });
  const dw = await page.evaluate(() => ({ w: window.__writes.map(w => ({ op: w.op, key: w.key })), it: window.__store['lineOrders:2026-11-14'].find(x => x.id === 'H2'), n: window.__store['lineOrders:2026-11-14'].length }));
  check('กด × = ติดป้ายซ่อนที่คีย์ lineOrders เท่านั้น (patchOps 1 ครั้ง ไม่ลบรายการอื่น)', dw.w.length === 1 && dw.w[0].op === 'patchOps' && dw.w[0].key === 'lineOrders:2026-11-14' && dw.it.dismissed === true && dw.n === 5, dw);

  // ============ B) จำผู้โอน ============
  await page.evaluate(async () => { window.__writes = []; await switchTab('billing'); });
  await page.waitForSelector('#slipInbox [data-slipchip]', { timeout: 8000 });
  await page.click('[data-slipchip="L1"]');
  await page.waitForSelector('#slipMatchResults [data-slipkind=exact]', { timeout: 5000 });
  check('ยังไม่เคยยืนยัน → ไม่มีป้ายผู้โอน', !(await page.$('[data-sliphint]')));
  check('แตะสลิป/ดูผล ไม่เขียน slipPayers', !(await page.evaluate(() => window.__writes.some(w => w.key === 'slipPayers'))));
  await page.click('[data-slipiso="2026-11-14"][data-slipcode="02"]');
  await page.waitForSelector('[data-slipconfirm]');
  check('เลือกบิลแล้วยังไม่จด', !(await page.evaluate(() => window.__writes.some(w => w.key === 'slipPayers'))));
  await page.click('[data-slipconfirm]');
  await page.waitForFunction(() => !slipMatchBusy_, null, { timeout: 15000 });
  const mem = await page.evaluate(() => ({ payers: window.__store.slipPayers, w: window.__writes.filter(w => w.key === 'slipPayers').map(w => w.op), paid: !!(window.__store['day:2026-11-14'].billingPaid || {})['02'], dayW: window.__writes.filter(w => /^day:/.test(w.key)).length }));
  check('ยืนยันติ๊กจ่ายสำเร็จ → จดผู้โอน↔สาขา 02 แบบ patchOps', mem.paid && mem.w.length === 1 && mem.w[0] === 'patchOps' && Array.isArray(mem.payers) && mem.payers.length === 1 && mem.payers[0].code === '02' && mem.payers[0].count === 1 && mem.payers[0].acct === 'xxx-x-x1234-x', mem);
  check('การจดไม่เพิ่มการเขียนคีย์วัน (ยังเขียนบิลจุดเดียว)', mem.dayW === 1, mem.dayW);

  // สลิปใบถัดไปจากผู้โอนคนเดิม (ชื่อเว้นวรรคต่าง / เลขบัญชีตัวพิมพ์ต่าง) ยอด 700 → บิลสาขา 01 ยอดตรง; สาขา 02 ไม่มีบิล 700
  await page.click('[data-slipchip="L2"]');
  await page.waitForSelector('#slipMatchResults [data-slipkind=exact]', { timeout: 5000 });
  check('ผู้โอนเดิมแต่บิลที่ยอดตรงเป็นสาขาอื่น → ไม่ติดป้าย (ไม่เดา)', !(await page.$('[data-sliphint]')));
  await page.evaluate(async () => { window.__store['day:2026-11-13'].orders['02'] = { custom: [{ name: 'ของ', qty: 1, price: 700 }] }; slipMatchCands_ = null; await renderSlipMatchResults_(); });
  const hint = await page.evaluate(() => Array.from(document.querySelectorAll('#slipMatchResults button.slip-match')).map(b => b.dataset.slipcode + ':' + (b.querySelector('[data-sliphint]') ? b.querySelector('[data-sliphint]').textContent : '')));
  check('ผู้โอนเดิม + มีบิลสาขา 02 → ติดป้าย "เคยจ่ายสาขานี้ 1 ครั้ง" เฉพาะปุ่มสาขา 02', hint.filter(h => /เคยจ่ายสาขานี้ 1 ครั้ง/.test(h)).length === 1 && hint.some(h => /^02:.*เคยจ่าย/.test(h)) && hint.some(h => /^01:$/.test(h)), hint);
  check('ป้ายแค่บอก: ไม่เลือกบิลให้ ไม่มีแผงยืนยันเอง', !(await page.$('[data-slippanel]')) && await page.evaluate(() => slipMatchDraft_.pick === null));
  await page.screenshot({ path: path.join(SHOT_DIR, 'slip-payer-hint.png'), clip: await page.evaluate(() => { const r = document.getElementById('slipMatchCard').getBoundingClientRect(); return { x: 0, y: Math.max(0, r.top + scrollY), width: 420, height: Math.min(900, r.height) }; }) }).catch(() => {});
  check('การ์ดไม่ล้นจอ 420px', await page.evaluate(() => document.documentElement.scrollWidth <= 420));
  await page.click('[data-slipchip="L3"]');
  await page.waitForSelector('#slipMatchResults [data-slipkind=exact]', { timeout: 5000 });
  check('ผู้โอนคนอื่น → ไม่มีป้าย', !(await page.$('[data-sliphint]')));

  // ยืนยันซ้ำกับสาขาเดิม → count เพิ่ม ไม่เกิดรายการซ้ำ
  await page.click('[data-slipchip="L2"]');
  await page.waitForSelector('[data-slipiso="2026-11-13"][data-slipcode="02"]', { timeout: 5000 });
  await page.click('[data-slipiso="2026-11-13"][data-slipcode="02"]');
  await page.waitForSelector('[data-slipconfirm]');
  await page.click('[data-slipconfirm]');
  await page.waitForFunction(() => !slipMatchBusy_, null, { timeout: 15000 });
  const mem2 = await page.evaluate(() => window.__store.slipPayers);
  check('ยืนยันสาขาเดิมอีกครั้ง → รายการเดียว count = 2', mem2.length === 1 && mem2[0].count === 2, mem2);
  check('slipPayers อยู่ในรายการคีย์ที่สำรอง', await page.evaluate(() => BACKUP_EXTRA_ROOT_KEYS.indexOf('slipPayers') >= 0));
  check('พิมพ์ยอดเอง (ไม่ได้มาจากสลิป) → ไม่มีป้าย ไม่จด', await page.evaluate(async () => { const h = await slipPayerHints_(null); return Object.keys(h).length === 0 && slipPayerSig_('', '') === '' && slipPayerSig_('', 'xx12') === ''; }));

  await finish(browser);
})();
