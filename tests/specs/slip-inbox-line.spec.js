const path = require('path');
const fs = require('fs');
const { launch, mkDay, openApp, makeChecker, stripBanner } = require('../helpers');

// สลิปจากบอท LINE (lineInbox:YYYY-MM-DD) ในการ์ด "จับคู่ยอดโอน" + แผงยืนยันอยู่ใต้บิลที่เลือก + สีตัวอักษรเขียว/ชมพูบนธีมสว่าง
// กฎเหล็ก: แตะสลิป = เติมยอดในช่องเท่านั้น ไม่เขียนอะไร; ติ๊กจ่ายยังต้องเลือกบิล + กดยืนยันเอง
const TODAY = '2026-11-12';
const SHOT_DIR = process.env.SHOT_DIR || path.join(__dirname, '..', 'screenshots');
const bill = amt => ({ custom: [{ name: 'ของ', qty: 1, price: amt }] });

function seedStore(){
  return {
    ['day:' + TODAY]: mkDay({ orders: { '01': bill(1250), '09': bill(1200) } }),
    ['day:2026-11-10']: mkDay({ orders: { '02': bill(1250), '05': bill(1300) } }),
    ['lineInbox:' + TODAY]: [
      { id: 'L1', type: 'slip', at: TODAY + 'T10:21:00', amount: 1250, slipDate: '2026-11-11', slipTime: '10:21', sender: 'นาย สมชาย ใจดี', postedBy: 'สาขา 1' },
      { id: 'L2', type: 'slip', at: TODAY + 'T10:30:00', amount: null, amountCands: [1250, 1300], slipDate: TODAY, slipTime: '10:30', sender: '', postedBy: 'สาขา 9' },
      { id: 'L3', type: 'text', at: TODAY + 'T10:40:00', text: 'สวัสดี', postedBy: 'สาขา 9' },
      { id: 'L4', type: 'slip', at: TODAY + 'T08:00:00', amount: 900, slipDate: TODAY, matched: { iso: TODAY, code: '03' } },
    ],
    ['lineInbox:2026-11-11']: [{ id: 'L5', type: 'slip', at: '2026-11-11T18:00:00', amount: 1300, slipDate: '2026-11-11', slipTime: '18:00', sender: 'นาง ปลา', postedBy: '' }],
    ['lineInbox:2026-11-10']: [{ id: 'L6', type: 'slip', at: '2026-11-10T09:00:00', amount: 1300, slipDate: '2026-11-11', slipTime: '18:00', sender: 'นาง ปลา', matched: { iso: '2026-11-10', code: '05' } }],
    ['lineInbox:2026-11-05']: [{ id: 'L9', type: 'slip', at: '2026-11-05T18:00:00', amount: 777, slipDate: '2026-11-05' }],
  };
}
const lum = c => { const isF = /^color\(srgb/.test(c); const m = c.match(/\d*\.?\d+/g).map(Number).slice(0, 3).map(v => { v = isF ? v : v / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

(async () => {
  const browser = await launch();
  const { check, finish } = makeChecker();
  const page = await openApp(browser, { store: seedStore(), date: TODAY });
  await page.clock.setFixedTime(new Date(TODAY + 'T10:00:00+07:00'));
  await page.evaluate(async () => {
    window.__toasts = [];
    const orig = window.showToast;
    window.showToast = m => { window.__toasts.push(String(m)); return orig(m); };
    await switchTab('billing');
  });
  await stripBanner(page);
  await page.waitForSelector('#slipInbox [data-slipchip]', { timeout: 8000 });
  await page.evaluate(() => { window.__writes = []; });

  const chips = await page.evaluate(() => Array.from(document.querySelectorAll('#slipInbox [data-slipchip]')).map(b => b.dataset.slipchip + '|' + b.textContent.replace(/\s+/g, ' ').trim()));
  check('โชว์เฉพาะสลิป 3 วันล่าสุด ที่ยังไม่จับคู่/ไม่ซ่อน เรียงใหม่สุดก่อน', chips.map(c => c.split('|')[0]).join(',') === 'L2,L1,L5', chips);
  check('สลิปที่อ่านยอดไม่ได้ขึ้นว่า "อ่านยอดไม่ได้" (ไม่เดายอด)', /อ่านยอดไม่ได้/.test(chips[0]));
  check('สลิปหน้าตาเหมือนใบที่จับคู่ไปแล้ว (ยอด/วันที่/เวลา/ผู้โอน) → ติดป้ายอาจซ้ำ', /อาจซ้ำ/.test(chips[2]) && await page.evaluate(() => document.querySelector('[data-slipchip="L5"]').classList.contains('dup')), chips[2]);
  check('ใบที่ไม่ซ้ำไม่มีป้าย', !/อาจซ้ำ/.test(chips[1]));
  check('id ซ้ำในคีย์เดียวกันนับใบเดียว', await page.evaluate(async () => { window.__store['lineInbox:2026-11-12'].push(Object.assign({}, window.__store['lineInbox:2026-11-12'][0])); const r = await loadSlipInbox_(true); window.__store['lineInbox:2026-11-12'].pop(); await loadSlipInbox_(true); return r.filter(x => x.id === 'L1').length === 1; }));
  check('เตือนวันที่โอนในอนาคต/เก่ากว่า 7 วัน (ไม่บล็อก)', await page.evaluate(() => /อนาคต/.test(slipDateWarnText_('2026-11-20', '2026-11-10')) && /เก่ากว่า 7 วัน/.test(slipDateWarnText_('2026-11-01', '2026-10-30')) && slipDateWarnText_('2026-11-11', '2026-11-10') === ''));
  check('ชิปโชว์ยอด + เวลา + ผู้โอน', /฿1,250/.test(chips[1]) && /10:21/.test(chips[1]) && /สมชาย/.test(chips[1]), chips[1]);

  await page.click('[data-slipchip="L2"]');
  await page.waitForTimeout(300);
  check('แตะสลิปอ่านยอดไม่ได้ → บอกให้พิมพ์เอง ไม่เติมยอด', (await page.inputValue('#slipMatchAmount')) === '' && (await page.evaluate(() => window.__toasts.some(t => /พิมพ์ยอดเอง/.test(t)))));

  await page.click('[data-slipchip="L1"]');
  await page.waitForTimeout(700);
  check('แตะสลิป → เติมยอด 1250 ในช่อง', (await page.inputValue('#slipMatchAmount')) === '1250');
  check('ชิปที่เลือกมีกรอบไฮไลต์', await page.evaluate(() => document.querySelector('[data-slipchip="L1"]').classList.contains('on')));
  check('ยังไม่มีแผงยืนยันจนกว่าจะเลือกบิลเอง', !(await page.$('[data-slippanel]')));
  check('แตะสลิปไม่เขียนอะไร', (await page.evaluate(() => window.__writes.length)) === 0);

  // เลือกบิลตัวที่ 2 (เก่ากว่า) → แผงต้องอยู่ถัดจากปุ่มนั้นทันที ไม่ใช่ท้ายรายการ
  const order = await page.evaluate(() => Array.from(document.querySelectorAll('#slipMatchResults button.slip-match[data-slipkind=exact]')).map(b => b.dataset.slipiso + '/' + b.dataset.slipcode));
  check('บิลยอดตรง 2 ใบ', order.join(',') === '2026-11-12/01,2026-11-10/02', order);
  await page.click('[data-slipiso="2026-11-10"][data-slipcode="02"]');
  await page.waitForTimeout(400);
  const pos = await page.evaluate(() => {
    const p = document.querySelector('[data-slippanel]');
    const prev = p && p.previousElementSibling;
    return { prev: prev ? prev.dataset.slipiso + '/' + prev.dataset.slipcode : null, prevPicked: prev && prev.classList.contains('picked'), date: document.getElementById('slipMatchPaidDate').value };
  });
  check('แผงยืนยันอยู่ใต้บิลที่เลือกทันที', pos.prev === '2026-11-10/02' && pos.prevPicked, pos);
  check('วันที่โอนเติมจากวันที่ในสลิป', pos.date === '2026-11-11', pos.date);
  await page.screenshot({ path: path.join(SHOT_DIR, 'slip-inbox-line-picked.png'), fullPage: false, clip: await page.evaluate(() => { const r = document.getElementById('slipMatchCard').getBoundingClientRect(); return { x: 0, y: Math.max(0, r.top + scrollY), width: 420, height: Math.min(900, r.height) }; }) }).catch(() => {});
  check('เลือกบิลยังไม่เขียนอะไร', (await page.evaluate(() => window.__writes.length)) === 0);

  await page.click('[data-slipconfirm]');
  await page.waitForFunction(() => !slipMatchBusy_, null, { timeout: 15000 });
  const after = await page.evaluate(() => ({
    writes: window.__writes.map(w => ({ op: w.op, key: w.key, path: w.path })),
    paid: (window.__store['day:2026-11-10'].billingPaid || {})['02'],
    inbox: window.__store['lineInbox:2026-11-12'].find(x => x.id === 'L1'),
    chips: Array.from(document.querySelectorAll('#slipInbox [data-slipchip]')).map(b => b.dataset.slipchip),
  }));
  const dayW = after.writes.filter(w => w.key.startsWith('day:'));
  check('ยืนยัน = เขียนบิลจุดเดียว billingPaid/02 ของวันบิล', dayW.length === 1 && dayW[0].key === 'day:2026-11-10' && JSON.stringify(dayW[0].path) === '["billingPaid","02"]', after.writes);
  check('บันทึกยอดโอน + วันที่โอนจากสลิป', after.paid && after.paid.paid === true && after.paid.transferAmount === 1250 && after.paid.paidDate === '2026-11-11', after.paid);
  check('สลิปถูกติดป้ายจับคู่แล้ว (ที่คีย์ lineInbox เท่านั้น)', after.inbox.matched && after.inbox.matched.iso === '2026-11-10' && after.inbox.matched.code === '02', after.inbox);
  check('เขียนแค่ 2 คีย์: วันบิล + lineInbox (+ log กิจกรรม)', after.writes.every(w => /^(day:2026-11-10|lineInbox:2026-11-12|actlog:|activityLog|dayRevs)/.test(w.key)), after.writes.map(w => w.key));
  check('สลิปที่จับคู่แล้วหายจากแถบ', after.chips.join(',') === 'L2,L5', after.chips);

  // พิมพ์ยอดเองหลังแตะสลิป → ไม่ผูกกับสลิป (ไม่ติดป้ายผิดใบ)
  await page.click('[data-slipchip="L5"]');
  await page.waitForTimeout(500);
  await page.fill('#slipMatchAmount', '1200');
  await page.waitForTimeout(600);
  check('พิมพ์ยอดใหม่ → เลิกผูกกับสลิป', await page.evaluate(() => slipMatchDraft_.inbox === null && !document.querySelector('[data-slipchip="L5"]').classList.contains('on')));

  // แตะชิปที่อาจซ้ำ → เลือกบิล → คำเตือนยังอยู่ในแผงยืนยัน
  await page.click('[data-slipchip="L5"]');
  await page.waitForTimeout(700);
  await page.click('#slipMatchResults [data-slipkind=exact]');
  await page.waitForTimeout(400);
  check('ชิปอาจซ้ำ: คำเตือนอยู่ในแผงยืนยันด้วย', !!(await page.$('[data-slippanel] [data-slipdupwarn]')));
  await page.click('[data-slipcancel]');
  await page.fill('#slipMatchAmount', '');
  await page.waitForTimeout(400);
  // ซ่อนสลิป
  await page.evaluate(() => { window.__writes = []; });
  await page.click('[data-slipchipx="L5"]');
  await page.waitForTimeout(500);
  const hid = await page.evaluate(() => ({ w: window.__writes.map(w => w.key), it: window.__store['lineInbox:2026-11-11'][0], chips: Array.from(document.querySelectorAll('#slipInbox [data-slipchip]')).map(b => b.dataset.slipchip) }));
  check('× ซ่อนสลิป → เขียนป้าย dismissed ที่ lineInbox เท่านั้น', hid.w.length >= 1 && hid.w.every(k => k === 'lineInbox:2026-11-11' || /^(actlog:|activityLog|dayRevs)/.test(k)) && hid.it.dismissed === true && hid.chips.join(',') === 'L2', hid);
  check('lineInbox อยู่ในรายการสำรองข้อมูล', await page.evaluate(() => BACKUP_PREFIXES.includes('lineInbox:')));

  // ไม่มีคีย์ lineInbox เลย → ไม่โชว์แถบ
  const p2 = await openApp(browser, { store: { ['day:' + TODAY]: mkDay({ orders: { '01': bill(1250) } }) }, date: TODAY });
  await p2.clock.setFixedTime(new Date(TODAY + 'T10:00:00+07:00'));
  await p2.evaluate(async () => { await switchTab('billing'); });
  await p2.waitForTimeout(600);
  check('ไม่มีสลิปจาก LINE → ซ่อนแถบ', await p2.evaluate(() => getComputedStyle(document.getElementById('slipInbox')).display === 'none'));

  // สีตัวอักษรเขียว/ชมพู ต้องอ่านชัดบนพื้นการ์ดทุกธีมสว่าง (คอนทราสต์ ≥ 4.5)
  for(const theme of ['', 'mermaid', 'sea', 'neon']){
    const r = await page.evaluate(t => {
      if(t) document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme');
      const host = document.getElementById('slipMatchCard').querySelector('.card');
      const mk = (tag, cls) => { const e = document.createElement(tag); e.className = cls; e.textContent = 'x'; host.appendChild(e); return e; };
      const els = { success: mk('button', 'lot-hold'), warn: mk('div', 'slip-warn') };
      const sm = document.createElement('button'); sm.className = 'slip-match best'; sm.innerHTML = '<span>x<small>ยอดตรงเป๊ะ</small></span>'; host.appendChild(sm);
      let bg = 'rgba(0, 0, 0, 0)', n = host;
      while(n && /rgba\(0, 0, 0, 0\)|transparent/.test(bg)){ bg = getComputedStyle(n).backgroundColor; n = n.parentElement; }
      if(/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) bg = 'rgb(255, 255, 255)'; // พื้นเป็นภาพไล่สีของ body → เทียบกับขาว (ธีมสว่าง)
      const smBg = getComputedStyle(sm).backgroundColor;
      const out = { bg, smBg: /rgba\(0, 0, 0, 0\)/.test(smBg) ? bg : smBg, hold: getComputedStyle(els.success).color, warn: getComputedStyle(els.warn).color, best: getComputedStyle(sm.querySelector('small')).color };
      els.success.remove(); els.warn.remove(); sm.remove();
      return out;
    }, theme);
    const c = { hold: contrast(r.hold, r.bg), warn: contrast(r.warn, r.bg), best: contrast(r.best, r.smBg) };
    check(`ธีม ${theme || 'macaron'}: ตัวเขียว/ชมพูอ่านชัด (≥4.5)`, c.hold >= 4.5 && c.warn >= 4.5 && c.best >= 4.5, { c, r });
  }

  await finish(browser);
})();
