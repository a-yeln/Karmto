const path = require('path');
const fs = require('fs');
const { launch, openApp, makeChecker } = require('../helpers');

// กันบิลล็อตซ้ำ (lotProductBills / lotTransportBills) ที่ต้นเหตุใน ensureLotBillRecords
// - แคชบิลเก่าแต่ของจริงมีแล้ว → อ่านสดก่อน ไม่สร้างซ้ำ (เช็คด้วย billId; บิลขนส่ง id แบบ uid('lt') ก็ต้องรู้)
// - กันเรียกซ้อน • เติมย้อนหลังยังทำงาน • บิลอายุไม่ถึง 10 นาทีรอก่อน • ออฟไลน์ไม่เข้าคิว • ไม่แตะบิลจ่ายแล้ว/บิลซ้ำเดิม
// - เดือนที่ปิดแล้วไม่สร้าง • ป้าย "พบบิลล็อตซ้ำ N ใบ" บนศูนย์บัญชาการ อ่านอย่างเดียว
const SHOT_DIR = process.env.SHOT_DIR || path.join(__dirname, '..', 'screenshots');
const T = '2026-11-26';
const NOW = new Date(T + 'T10:00:00+07:00').getTime();
const OLD = 'bill' + (NOW - 6 * 24 * 3600 * 1000) + '-old001';   // 6 วันก่อน
const OLD2 = 'bill' + (NOW - 20 * 60 * 1000) + '-oth002';         // 20 นาทีก่อน (เครื่องอื่น)
const YOUNG = 'bill' + (NOW - 5 * 60 * 1000) + '-new003';         // 5 นาทีก่อน

const lot = (billId, over) => Object.assign({
  id: billId + '-0', productId: 'p3', seller: 'ม๊ะก๊าด', sellerNote: '', buyDate: '2026-11-20',
  qtyTotal: 10, pricePerKg: 120, extra: 30, note: '', billId,
  draws: [{ id: 'd1', date: '2026-11-21', qtyUsed: 2, sellableQty: 2, costedQty: 2, claimedQty: 0 }]
}, over || {});
const lp = (billId, over) => Object.assign({ id: 'lp' + billId, billId, seller: 'ม๊ะก๊าด', sellerNote: '', amount: 1200, buyDate: '2026-11-20', productLabel: 'กุ้ง', paid: false, paidDate: null }, over || {});
const lt = (billId, over) => Object.assign({ id: 'lt' + (NOW - 6 * 24 * 3600 * 1000) + '-zz9abc', billId, payee: 'ลาล่า', amount: 30, buyDate: '2026-11-20', productLabel: 'กุ้ง', paid: false, paidDate: null }, over || {});

(async () => {
  const browser = await launch();
  const { check, finish } = makeChecker();

  const open = async (store, viewport) => {
    const page = await openApp(browser, { store, date: T, viewport: viewport || { width: 420, height: 1100 } });
    await page.clock.setFixedTime(new Date(T + 'T10:00:00+07:00'));
    await page.route(/fonts\./, r => r.abort());
    await page.evaluate(() => { rawLotsCache_ = null; lotProductBillsCache_ = null; lotTransportBillsCache_ = null; closedMonths_ = {}; window.__forceOffline = false; try{ localStorage.removeItem('karmto_offline_queue'); }catch(e){} });
    return page;
  };
  const snap = page => page.evaluate(() => {
    const per = arr => { const m = {}; (arr || []).forEach(b => { m[b.billId] = (m[b.billId] || 0) + 1; }); return m; };
    const s = window.__store;
    return {
      lp: s.lotProductBills || null, lt: s.lotTransportBills || null, perLp: per(s.lotProductBills), perLt: per(s.lotTransportBills),
      pushes: window.__writes.filter(w => (w.key === 'lotProductBills' || w.key === 'lotTransportBills') && (w.ops || []).some(o => o.push)).length,
      billWrites: window.__writes.filter(w => w.key === 'lotProductBills' || w.key === 'lotTransportBills').length,
      lotWrites: window.__writes.filter(w => w.key === 'rawLots').length,
      rawLots: s.rawLots
    };
  });

  // 1) แคชเก่า [] แต่ store มีบิลแล้ว (lt แบบ uid('lt')) → ไม่สร้างซ้ำ ไม่มี push
  {
    const page = await open({ rawLots: [lot(OLD)], lotProductBills: [lp(OLD)], lotTransportBills: [lt(OLD)] });
    await page.evaluate(async () => { lotProductBillsCache_ = []; lotTransportBillsCache_ = []; await ensureLotBillRecords(JSON.parse(JSON.stringify(window.__store.rawLots))); });
    const s = await snap(page);
    check('1 stale cache: still 1 product + 1 transport bill per billId, no push', s.perLp[OLD] === 1 && s.perLt[OLD] === 1 && s.pushes === 0, s);
    const c = await page.evaluate(() => ({ lp: (lotProductBillsCache_ || []).length, lt: (lotTransportBillsCache_ || []).length }));
    check('1 cache refreshed to fresh values', c.lp === 1 && c.lt === 1, c);
    await page.close();
  }

  // 2) เรียกพร้อมกัน 2 รอบ (บิลขาดจริง) → บิลละ 1 ใบ
  {
    const page = await open({ rawLots: [lot(OLD)] });
    await page.evaluate(async () => { const l = JSON.parse(JSON.stringify(window.__store.rawLots)); await Promise.all([ensureLotBillRecords(l), ensureLotBillRecords(l)]); });
    const s = await snap(page);
    check('2 concurrent calls: exactly 1 product + 1 transport bill', s.perLp[OLD] === 1 && s.perLt[OLD] === 1, s);
    await page.close();
  }

  // 3) เติมย้อนหลังยังทำงาน: ยอดถูก ยังไม่จ่าย ไม่แตะ rawLots/costedQty
  {
    const lots = [lot(OLD, { qtyTotal: 10, pricePerKg: 120, extra: 30 }), lot(OLD, { id: OLD + '-1', productId: 'p1', qtyTotal: 5, pricePerKg: 80, extra: 15.5 })];
    const page = await open({ rawLots: lots });
    await page.evaluate(async () => { await ensureLotBillRecords(JSON.parse(JSON.stringify(window.__store.rawLots))); });
    const s = await snap(page);
    const p = (s.lp || [])[0] || {}, t = (s.lt || [])[0] || {};
    check('3 backfill: 1 product bill amount = sum qty×price (1600), unpaid', s.perLp[OLD] === 1 && p.amount === 1600 && p.paid === false && p.billId === OLD && p.buyDate === '2026-11-20', p);
    check('3 backfill: 1 transport bill = sum of extra (45.5), unpaid', s.perLt[OLD] === 1 && t.amount === 45.5 && t.paid === false, t);
    check('3 rawLots not written, costedQty unchanged', s.lotWrites === 0 && JSON.stringify(s.rawLots) === JSON.stringify(lots), s.lotWrites);
    await page.close();
  }

  // 4) billId อายุไม่ถึง 10 นาที → ข้าม
  {
    const page = await open({ rawLots: [lot(YOUNG)] });
    await page.evaluate(async () => { await ensureLotBillRecords(JSON.parse(JSON.stringify(window.__store.rawLots))); });
    const s = await snap(page);
    check('4 young billId (<10 min): no bills created, no writes', !s.lp && !s.lt && s.billWrites === 0, s);
    await page.close();
  }

  // 5) ออฟไลน์ (ผ่านตัวห่อจริง แคชพร้อมให้เข้าคิวได้) → คิวว่าง store ไม่เปลี่ยน
  {
    const page = await open({ rawLots: [lot(OLD)] });
    const r = await page.evaluate(async () => {
      window.storage = wrapStorageForDayRevs_(window.storage);
      lotProductBillsCache_ = []; lotTransportBillsCache_ = []; window.__forceOffline = true;
      const before = JSON.stringify(window.__store);
      await ensureLotBillRecords(JSON.parse(JSON.stringify(window.__store.rawLots)));
      const q1 = readOfflineQueue_().length;
      // คิวค้างอยู่ (ต่อเน็ตแล้วแต่ยังส่งไม่หมด) ก็ต้องไม่ทำ
      window.__forceOffline = false; lotProductBillsCache_ = []; lotTransportBillsCache_ = [];
      localStorage.setItem('karmto_offline_queue', JSON.stringify([{ m: 'patchField', key: 'settings', path: ['x'], value: 1, at: 1, qid: 'q1' }]));
      await ensureLotBillRecords(JSON.parse(JSON.stringify(window.__store.rawLots)));
      const q2 = readOfflineQueue_().length;
      localStorage.removeItem('karmto_offline_queue');
      return { q1, q2, same: JSON.stringify(window.__store) === before, writes: window.__writes.length };
    });
    check('5 offline: offline queue empty, store unchanged', r.q1 === 0 && r.same && r.writes === 0, r);
    check('5 pending offline queue: nothing added, store unchanged', r.q2 === 1 && r.same, r);
    await page.close();
  }

  // 6) บิลจ่ายแล้วมีอยู่ (แคชเก่า) → ยัง paid:true ใบเดียว ไม่มีการเขียน
  {
    const page = await open({ rawLots: [lot(OLD)], lotProductBills: [lp(OLD, { paid: true, paidDate: '2026-11-21' })], lotTransportBills: [lt(OLD, { paid: true, paidDate: '2026-11-21' })] });
    await page.evaluate(async () => { lotProductBillsCache_ = []; lotTransportBillsCache_ = []; await ensureLotBillRecords(JSON.parse(JSON.stringify(window.__store.rawLots))); });
    const s = await snap(page);
    check('6 paid bills untouched: 1 each, paid:true, no writes', s.perLp[OLD] === 1 && s.perLt[OLD] === 1 && s.lp[0].paid === true && s.lt[0].paid === true && s.billWrites === 0, s);
    await page.close();
  }

  // 7) มีบิลซ้ำอยู่ก่อน → ไม่ลบ ไม่เพิ่ม
  {
    const dupLp = [lp(OLD), lp(OLD, { id: 'lp-dup-2' })];
    const page = await open({ rawLots: [lot(OLD)], lotProductBills: dupLp, lotTransportBills: [lt(OLD)] });
    await page.evaluate(async () => { lotProductBillsCache_ = []; lotTransportBillsCache_ = []; await ensureLotBillRecords(JSON.parse(JSON.stringify(window.__store.rawLots))); });
    const s = await snap(page);
    check('7 existing duplicates kept as-is (2 product), no writes', s.perLp[OLD] === 2 && s.perLt[OLD] === 1 && s.billWrites === 0 && JSON.stringify(s.lp) === JSON.stringify(dupLp), s);
    await page.close();
  }

  // 8) writeRootArrayOp_ คืนล็อตของเครื่องอื่น (บิลของมันมีบน server แล้ว แต่แคชเครื่องนี้ไม่รู้) → renderLotList ไม่สร้างซ้ำ
  {
    const page = await open({ rawLots: [lot(OLD)], lotProductBills: [lp(OLD)], lotTransportBills: [lt(OLD)] });
    const s0 = await page.evaluate(async (OLD2) => {
      await loadLotProductBills(); await loadLotTransportBills(); // แคชเครื่องนี้: มีแค่บิลของ OLD
      const other = { id: OLD2 + '-0', productId: 'p2', seller: 'มนต์', sellerNote: '', buyDate: '2026-11-26', qtyTotal: 4, pricePerKg: 200, extra: 20, note: '', billId: OLD2, draws: [] };
      window.__store.rawLots.push(other);
      window.__store.lotProductBills.push({ id: 'lp' + OLD2, billId: OLD2, amount: 800, buyDate: '2026-11-26', paid: false });
      window.__store.lotTransportBills.push({ id: 'lt' + Date.now() + '-qq1', billId: OLD2, amount: 20, buyDate: '2026-11-26', paid: false });
      const updated = await writeRootArrayOp_('rawLots', { matchField: 'id', matchValue: window.__store.rawLots[0].id, set: { note: 'แก้หมายเหตุ' } }, arr => { rawLotsCache_ = arr; });
      await renderLotList(updated);
      return updated.length;
    }, OLD2);
    const s = await snap(page);
    check('8 other-device lot via writeRootArrayOp_ + renderLotList: 1 bill per billId, no push', s0 === 2 && s.perLp[OLD] === 1 && s.perLp[OLD2] === 1 && s.perLt[OLD] === 1 && s.perLt[OLD2] === 1 && s.pushes === 0, s);
    await page.close();
  }

  // 9) buyDate อยู่ในเดือนที่ปิดแล้ว → ไม่สร้าง
  {
    const page = await open({ rawLots: [lot(OLD, { buyDate: '2026-10-10' })] });
    await page.evaluate(async () => { closedMonths_ = { '2026-10': { at: 1, dev: 't' } }; await ensureLotBillRecords(JSON.parse(JSON.stringify(window.__store.rawLots))); });
    const s = await snap(page);
    check('9 closed month: no backfill bills, no writes', !s.lp && !s.lt && s.billWrites === 0, s);
    await page.close();
  }

  // 10) ป้าย "พบบิลล็อตซ้ำ N ใบ" — จำนวนถูก อ่านอย่างเดียว กัน HTML แปลก
  const EVIL = '<img src=x id=evil>';
  const dupStore = () => ({
    rawLots: [],
    lotProductBills: [lp('bA', { buyDate: '2026-11-24' }), lp('bA', { id: 'lp2', buyDate: '2026-11-24' }), lp('bB', { buyDate: '2026-11-23' })],
    lotTransportBills: [lt(EVIL, { id: 't1', buyDate: '2026-11-22' }), lt(EVIL, { id: 't2', buyDate: '"><img src=y id=evil2>' }), lt('bC', { id: 't3' })],
  });
  {
    const page = await open(dupStore());
    const r = await page.evaluate(async () => {
      await switchTab('dashboard');
      const w0 = window.__writes.length;
      await renderTodayCommand_();
      const box = document.getElementById('cmdLotDup');
      return {
        has: !!box, text: box ? box.textContent : '',
        dates: box ? [...box.querySelectorAll('[data-lotdup]')].map(b => b.getAttribute('data-lotdup')) : [],
        btnTexts: box ? [...box.querySelectorAll('button')].map(b => b.textContent.trim()) : [],
        evil: !!document.querySelector('#cmdCenter #evil, #cmdCenter #evil2, #cmdCenter img'),
        wrote: window.__writes.length - w0
      };
    });
    check('10 badge shows "พบบิลล็อตซ้ำ 4 ใบ" (product 2 + transport 2)', r.has && r.text.includes('พบบิลล็อตซ้ำ 4 ใบ') && r.text.includes('สินค้า 2') && r.text.includes('ขนส่ง 2'), r);
    check('10 chips = valid buy dates only, newest first', JSON.stringify(r.dates) === JSON.stringify(['2026-11-24', '2026-11-22']), r.dates);
    check('10 no delete/edit buttons in badge', r.btnTexts.every(t => /^\d{2}\/\d{2}$/.test(t)), r.btnTexts);
    check('10 odd billId/buyDate (<img>) not injected as element', !r.evil, r);
    check('10 rendering writes nothing', r.wrote === 0, r.wrote);
    const go = await page.evaluate(async () => {
      const w0 = window.__writes.length;
      document.querySelector('[data-lotdup="2026-11-24"]').click();
      await new Promise(res => setTimeout(res, 900));
      return { date: currentDate, panels: [...document.querySelectorAll('.panel.active')].map(p => p.id), wrote: window.__writes.length - w0 };
    });
    check('10 tap date → purchase page of that day (lot bills), no writes', go.date === '2026-11-24' && go.panels.includes('panel-purchase') && go.wrote === 0, go);
    const none = await page.evaluate(async () => {
      window.__store.lotProductBills = [{ id: 'a', billId: 'x1', buyDate: '2026-11-24' }]; window.__store.lotTransportBills = [];
      lotProductBillsCache_ = null; lotTransportBillsCache_ = null;
      await switchTab('dashboard'); await renderTodayCommand_();
      return !!document.getElementById('cmdLotDup');
    });
    check('10 no duplicates → no badge', none === false);
    await page.close();
  }

  // ทุกธีม 420px: ไม่ล้นจอ ชิปแตะง่าย ตัวอักษรไม่กลืนพื้น + แคปจอ
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  for (const theme of ['', 'mermaid', 'sea', 'neon']) {
    for (const mode of ['full', 'color']) {
      const p = await open(dupStore());
      const m = await p.evaluate(async ({ theme, mode }) => {
        if (theme) document.documentElement.setAttribute('data-theme', theme); else document.documentElement.removeAttribute('data-theme');
        document.documentElement.setAttribute('data-tmode', mode);
        await switchTab('dashboard'); await renderTodayCommand_();
        const box = document.getElementById('cmdLotDup'); box.scrollIntoView({ block: 'center' });
        const chip = box.querySelector('.cmd-chip'); const cs = getComputedStyle(chip);
        const txt = getComputedStyle(box.querySelector('.cmd-txt'));
        return { overflow: document.documentElement.scrollWidth > window.innerWidth, boxRight: box.getBoundingClientRect().right, h: chip.getBoundingClientRect().height, color: cs.color, bg: cs.backgroundColor, txtColor: txt.color };
      }, { theme, mode });
      const name = (theme || 'macaron') + '-' + mode;
      check(`[${name}] no horizontal overflow, chip >=44px, text visible`, !m.overflow && m.boxRight <= 420 && m.h >= 44 && m.color !== m.bg, m);
      await p.locator('#cmdLotDup').screenshot({ path: path.join(SHOT_DIR, `cmd-lot-dup-${name}.png`) }).catch(() => {});
      await p.close();
    }
  }
  await finish(browser);
})();
