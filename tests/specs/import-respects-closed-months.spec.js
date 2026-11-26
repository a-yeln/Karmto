// กู้คืนจากไฟล์สำรองต้องไม่ทำให้เดือนที่ปิดของเดิมหาย และไม่ทับวันของเดือนที่ปิดแล้วเงียบๆ
// (importAllData: เดือนปิด = ของเดิม ∪ ไฟล์ ผ่าน writeClosedMonth_ ทีละเดือน, วันเดือนปิดที่ต่าง = ข้าม+แจ้ง, อ่านสถานะไม่ได้ = หยุดทั้งหมด)
const { launch, openApp, mkDay, makeChecker } = require('../helpers');

const CM9 = { '2026-09': { at: '2026-10-01T00:00:00Z', dev: 'iPhone' } };
const CM8 = { '2026-08': { at: '2026-09-01T00:00:00Z', dev: 'คอม' } };

(async () => {
  const browser = await launch();
  const { check, finish } = makeChecker();
  const page = await openApp(browser, { date: '2026-10-08' });
  const dialogs = [];
  let answer = true;
  page.on('dialog', async d => { dialogs.push(d.message()); if(answer) await d.accept(); else await d.dismiss(); });

  // รันนำเข้า 1 รอบ: ตั้ง store ใหม่, ดักคีย์ที่ bulkSet เขียน (mock ไม่ลง __writes), คืนผลหลังนำเข้า
  async function run(store, payload, opts = {}){
    dialogs.length = 0; answer = opts.answer !== undefined ? opts.answer : true;
    return await page.evaluate(async ({ store, payload, opts }) => {
      window.__store = JSON.parse(JSON.stringify(store));
      window.__writes = [];
      window.__bulkKeys = [];
      closedMonths_ = {};
      const origBulkSet = window.bulkSetStorageImpl, origBulkGet = window.bulkGetStorageImpl, origGet = window.storage.get;
      window.bulkSetStorageImpl = async items => { items.forEach(it => window.__bulkKeys.push(it.key)); return origBulkSet(items); };
      if(opts.bulkGetThrows) window.bulkGetStorageImpl = async () => { throw new Error('Network error: 500'); };
      if(opts.getCMThrows) window.storage.get = async key => { if(key === 'closedMonths') throw new Error('Network error: 503'); return origGet(key); };
      if(opts.bulkGetEmpty) window.bulkGetStorageImpl = async keys => { const out = await origBulkGet(keys); keys.forEach(k => { if(opts.bulkGetEmpty.includes(k)) out[k] = null; }); return out; };
      // อ่าน closedMonths ครั้งที่ 2 (ตรวจซ้ำหลัง confirm) = เครื่องอื่นเพิ่งปิดเดือนเพิ่ม
      let cmReads = 0;
      if(opts.cmSecondRead) window.storage.get = async key => { if(key === 'closedMonths' && ++cmReads === 2) window.__store.closedMonths = opts.cmSecondRead; return origGet(key); };
      // แคชรายชื่อคีย์ของตัวห่อ: จำรายชื่อเก่า (ไม่มีวันนั้น) ไว้ก่อน แล้วค่อยใส่วันนั้นลง store — ถ้านำเข้าเชื่อแคชจะพลาด
      if(opts.primeListWithout){
        const saved = window.__store[opts.primeListWithout]; delete window.__store[opts.primeListWithout];
        await window.storage.list('day:');
        window.__store[opts.primeListWithout] = saved;
      }
      const origList = window.storage.list; window.__listCalls = 0;
      window.storage.list = async (...a) => { window.__listCalls++; if(opts.listThrows) throw new Error('Network error: 502'); return origList.apply(window.storage, a); };
      const settingsBefore = JSON.stringify(settings);
      const before = JSON.stringify(window.__store);
      const file = new File([JSON.stringify(payload)], 'backup.json', { type: 'application/json' });
      let threw = null;
      try { await importAllData(file); } catch(e) { threw = String(e); }
      await new Promise(r => setTimeout(r, 300));
      window.bulkSetStorageImpl = origBulkSet; window.bulkGetStorageImpl = origBulkGet; window.storage.get = origGet; window.storage.list = origList;
      const writes = window.__writes.filter(w => !String(w.key).startsWith('actlog:'));
      return {
        threw, before, after: JSON.parse(JSON.stringify(window.__store)), writes, bulkKeys: window.__bulkKeys,
        settingsSame: JSON.stringify(settings) === settingsBefore,
        toast: (document.getElementById('toast') || {}).textContent || '',
        cmMem: JSON.parse(JSON.stringify(closedMonths_)), listCalls: window.__listCalls,
      };
    }, { store, payload, opts });
  }
  const cmWrites = r => r.writes.filter(w => w.key === 'closedMonths');
  const baseSettings = await page.evaluate(() => JSON.parse(JSON.stringify(settings)));

  // 1) ระบบปิด 09 ไฟล์ปิด 08 → ได้ทั้งสอง, ไม่มี set ทับ, มีแต่ patchOps path ['2026-08'] หลังกด confirm
  let r = await run({ closedMonths: CM9 }, { settings: baseSettings, days: {}, debts: [], closedMonths: CM8 });
  check('1 union: both months closed after import', JSON.stringify(Object.keys(r.after.closedMonths).sort()) === '["2026-08","2026-09"]', r.after.closedMonths);
  check('1 no set on closedMonths, only patchOps path [2026-08]', cmWrites(r).length === 1 && cmWrites(r)[0].op === 'patchOps' && JSON.stringify(cmWrites(r)[0].ops.map(o => o.path)) === '[["2026-08"]]', cmWrites(r));
  check('1 confirm shown and mentions locking Aug 2026', dialogs.length === 1 && dialogs[0].includes('ล็อกเดือน Aug 2026') && dialogs[0].includes('ตกลง = นำเข้าส่วนที่เหลือ'), dialogs);
  check('1 kept original 09 value', JSON.stringify(r.after.closedMonths['2026-09']) === JSON.stringify(CM9['2026-09']));

  // 2) ไฟล์ไม่มี closedMonths / null → ไม่เปลี่ยน ไม่เขียนคีย์นี้
  r = await run({ closedMonths: CM9 }, { settings: baseSettings, days: {}, debts: [] });
  check('2a file without closedMonths: key untouched, no write, no confirm', JSON.stringify(r.after.closedMonths) === JSON.stringify(CM9) && cmWrites(r).length === 0 && dialogs.length === 0, { cm: r.after.closedMonths, w: cmWrites(r) });
  r = await run({ closedMonths: CM9 }, { settings: baseSettings, days: {}, debts: [], closedMonths: null });
  check('2b file closedMonths null: key untouched, no write', JSON.stringify(r.after.closedMonths) === JSON.stringify(CM9) && cmWrites(r).length === 0, cmWrites(r));
  r = await run({}, { settings: baseSettings, days: {}, debts: [], closedMonths: {} });
  check('2c both empty: key not created', r.after.closedMonths === undefined && cmWrites(r).length === 0, cmWrites(r));

  // 3) ระบบไม่มีคีย์ ไฟล์มี → ได้ตามไฟล์หลัง confirm
  r = await run({}, { settings: baseSettings, days: {}, debts: [], closedMonths: CM9 });
  check('3 no key in system: follows file after confirm', JSON.stringify(r.after.closedMonths) === JSON.stringify(CM9) && dialogs.length === 1 && dialogs[0].includes('Sep 2026'), { cm: r.after.closedMonths, dialogs });
  check('3 lock state in memory updated', !!r.cmMem['2026-09'], r.cmMem);

  // 4+5) เดือน 09 ปิด: 09-05 ต่าง (แค่ billingPaid) ห้ามทับ, 09-06 ตรงกัน (คีย์สลับลำดับ) ไม่เขียน, 09-07 ไม่มีในระบบ ต้องเขียน; 10-08 เปิด นำเข้าปกติ
  const d0905sys = mkDay({ orders: { '01': { p1: 5 } } });
  const d0905file = mkDay({ orders: { '01': { p1: 5 } }, billingPaid: { '01': { paidDate: '2026-09-06' } } });
  const d0906 = mkDay({ orders: { '02': { p3: 2 } }, expenses: [{ id: 'e1', amount: 50 }] });
  const d0906reordered = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(d0906).reverse())));
  delete d0906reordered.dashNote; // ฟิลด์หาย normalizeDay_ เติมให้ ต้องนับว่าตรงกัน
  const d0907 = mkDay({ orders: { '03': { p2: 1 } } });
  const d1008 = mkDay({ orders: { '04': { p4: 3 } } });
  const sys4 = { closedMonths: CM9, 'day:2026-09-05': d0905sys, 'day:2026-09-06': d0906, 'day:2026-10-08': mkDay() };
  const file4 = { settings: baseSettings, debts: [], days: { 'day:2026-09-05': d0905file, 'day:2026-09-06': d0906reordered, 'day:2026-09-07': d0907, 'day:2026-10-08': d1008 } };
  r = await run(sys4, file4);
  check('4 differing closed day 09-05 not overwritten', JSON.stringify(r.after['day:2026-09-05']) === JSON.stringify(d0905sys), r.after['day:2026-09-05']);
  check('4 identical closed day 09-06 not rewritten', !r.bulkKeys.includes('day:2026-09-06'), r.bulkKeys);
  check('4 closed day missing in system 09-07 is written', JSON.stringify(r.after['day:2026-09-07']) === JSON.stringify(d0907) && r.bulkKeys.includes('day:2026-09-07'), r.bulkKeys);
  check('4 confirm lists 05/09/2026 only', dialogs.length === 1 && dialogs[0].includes('05/09/2026') && !dialogs[0].includes('06/09/2026') && !dialogs[0].includes('07/09/2026'), dialogs);
  check('4 toast reports skipped days', r.toast.includes('ข้าม 1 วัน (เดือนที่ปิด)'), r.toast);
  check('5 open month day 10-08 imported as before', JSON.stringify(r.after['day:2026-10-08']) === JSON.stringify(d1008), r.after['day:2026-10-08']);
  check('4 closedMonths untouched (no new months)', cmWrites(r).length === 0 && JSON.stringify(r.after.closedMonths) === JSON.stringify(CM9), cmWrites(r));
  const act = await page.evaluate(() => { const k = Object.keys(window.__store).filter(k => k.startsWith('actlog:')); return k.flatMap(x => window.__store[x]).map(e => e.text); });
  check('4 activity log lists skipped day', act.some(t => t.includes('ข้ามวันในเดือนที่ปิด') && t.includes('05/09/2026')), act);

  // 6) กดยกเลิก → settings/วัน/debts/rawLots/closedMonths ไม่เปลี่ยนเลย
  const sys6 = Object.assign({}, sys4, { debts: [{ id: 'd1', amount: 100 }], rawLots: [{ id: 'lotA' }], settings: baseSettings });
  const file6 = Object.assign({}, file4, { settings: Object.assign({}, baseSettings, { calendarDotsEnabled: false, zzMarker: 1 }), debts: [{ id: 'dX' }], rawLots: [{ id: 'lotX' }], closedMonths: CM8 });
  r = await run(sys6, file6, { answer: false });
  check('6 cancel: store unchanged', JSON.stringify(r.after) === r.before, Object.keys(r.after));
  check('6 cancel: nothing written at all', r.writes.length === 0 && r.bulkKeys.length === 0, { w: r.writes, b: r.bulkKeys });
  check('6 cancel: in-memory settings not replaced', r.settingsSame);
  check('6 cancel: toast says nothing imported', r.toast.includes('ยังไม่ได้นำเข้าอะไรเลย'), r.toast);

  // 7) อ่าน closedMonths ไม่ได้ (error อื่นที่ไม่ใช่ Key not found) → ยกเลิกทั้งหมด
  r = await run(sys6, file6, { getCMThrows: true });
  check('7 closedMonths read error: nothing written, no confirm', JSON.stringify(r.after) === r.before && r.writes.length === 0 && r.bulkKeys.length === 0 && dialogs.length === 0 && r.settingsSame, { w: r.writes, d: dialogs });
  check('7 clear message', r.toast.includes('เช็คเดือนที่ปิดในระบบไม่ได้'), r.toast);

  // 8) bulkGet ข้อมูลวันในเดือนปิดล้มเหลว → ยกเลิกทั้งหมด
  r = await run(sys6, file6, { bulkGetThrows: true });
  check('8 bulkGet error: nothing written, no confirm', JSON.stringify(r.after) === r.before && r.writes.length === 0 && r.bulkKeys.length === 0 && dialogs.length === 0 && r.settingsSame, { w: r.writes, d: dialogs });
  check('8 clear message', r.toast.includes('อ่านข้อมูลวันในเดือนที่ปิดไม่ได้'), r.toast);

  // 9) ไม่มีวันข้ามและไม่มีเดือนล็อกเพิ่ม → ไม่ขึ้น confirm (เดือนเดียวกันอยู่แล้ว + วันในเดือนปิดตรงกัน)
  r = await run({ closedMonths: CM9, 'day:2026-09-06': d0906 }, { settings: baseSettings, debts: [], closedMonths: CM9, days: { 'day:2026-09-06': d0906, 'day:2026-10-08': d1008 } });
  check('9 no confirm when nothing skipped and no new lock', dialogs.length === 0 && JSON.stringify(r.after['day:2026-10-08']) === JSON.stringify(d1008) && cmWrites(r).length === 0, { d: dialogs, w: cmWrites(r) });

  // ก) payload.days มีคีย์ที่ไม่ใช่วัน → ไม่ถูกเขียนผ่าน bulkSet, settings/closedMonths ในระบบไม่เปลี่ยน, แจ้งจำนวนที่ตัด
  r = await run({ closedMonths: CM9, settings: baseSettings }, { settings: baseSettings, debts: [], days: { settings: { hacked: 1 }, closedMonths: {}, 'day:2026-10-08': d1008, 'day:2026-10-8': d1008 } });
  check('ก non-day keys not bulk-written', !r.bulkKeys.includes('settings') && !r.bulkKeys.includes('closedMonths') && !r.bulkKeys.includes('day:2026-10-8') && r.bulkKeys.includes('day:2026-10-08'), r.bulkKeys);
  check('ก closedMonths/settings in store not replaced by junk', JSON.stringify(r.after.closedMonths) === JSON.stringify(CM9) && !(r.after.settings && r.after.settings.hacked), { cm: r.after.closedMonths });
  check('ก toast reports dropped keys', r.toast.includes('ตัดคีย์ที่ไม่ใช่วัน 3 รายการ'), r.toast);
  // คีย์ prototype ใน closedMonths ของระบบ ไม่ถูกนับเป็นเดือนปิด (ไม่พัง ไม่ข้ามวัน)
  r = await run({ closedMonths: JSON.parse('{"valueOf":{"at":"x"},"2026-09":{"at":"y"}}') }, { settings: baseSettings, debts: [], days: { 'day:2026-10-08': d1008 } });
  check('ก proto-like keys in server closedMonths harmless', JSON.stringify(r.after['day:2026-10-08']) === JSON.stringify(d1008) && r.threw === null && r.toast.includes('นำเข้าข้อมูลสำเร็จ'), r.toast);

  // ข) bulkGet คืนว่างแต่รายชื่อสด (ข้ามแคช) บอกว่ามีวันนั้นในเดือนปิด → หยุด ไม่เขียนอะไรเลย
  const sysB = { closedMonths: CM9, 'day:2026-09-07': d0907, 'day:2026-10-08': mkDay(), settings: baseSettings, debts: [{ id: 'd1' }] };
  const fileB = { settings: Object.assign({}, baseSettings, { zzMarker: 1 }), debts: [{ id: 'dX' }], rawLots: [{ id: 'lotX' }], days: { 'day:2026-09-07': mkDay({ orders: { '09': { p1: 9 } } }), 'day:2026-10-08': d1008 } };
  r = await run(sysB, fileB, { bulkGetEmpty: ['day:2026-09-07'], primeListWithout: 'day:2026-09-07' });
  check('ข exists in fresh list but read empty: nothing written', JSON.stringify(r.after) === r.before && r.writes.length === 0 && r.bulkKeys.length === 0 && r.settingsSame && dialogs.length === 0, { w: r.writes, b: r.bulkKeys, d: dialogs });
  check('ข clear message', r.toast.includes('มีอยู่ในระบบแต่อ่านค่าไม่ได้') && r.toast.includes('07/09/2026') && r.toast.includes('ยังไม่ได้นำเข้าอะไรเลย'), r.toast);
  r = await run(sysB, fileB, { bulkGetEmpty: ['day:2026-09-07'], listThrows: true });
  check('ข list fails: nothing written', JSON.stringify(r.after) === r.before && r.writes.length === 0 && r.bulkKeys.length === 0 && r.settingsSame, { w: r.writes, b: r.bulkKeys });
  check('ข list fails: clear message', r.toast.includes('เช็ครายชื่อวันในเดือนที่ปิดไม่ได้'), r.toast);

  // ค) bulkGet ว่าง และรายชื่อสดยืนยันว่าไม่มี → เขียนได้ (เจ้าของสั่ง)
  r = await run({ closedMonths: CM9 }, { settings: baseSettings, debts: [], days: { 'day:2026-09-07': d0907 } });
  check('ค missing closed day confirmed by list → written', JSON.stringify(r.after['day:2026-09-07']) === JSON.stringify(d0907) && r.bulkKeys.includes('day:2026-09-07') && r.listCalls >= 1, { b: r.bulkKeys, l: r.listCalls });

  // ง) เครื่องอื่นปิดเดือน 10 ระหว่างรอกด confirm → หยุดทั้งหมด
  r = await run({ closedMonths: CM9, settings: baseSettings }, { settings: Object.assign({}, baseSettings, { zzMarker: 1 }), debts: [{ id: 'dX' }], closedMonths: CM8, days: { 'day:2026-10-08': d1008 } }, { cmSecondRead: Object.assign({}, CM9, { '2026-10': { at: '2026-11-01T00:00:00Z', dev: 'Android' } }) });
  check('ง confirm was shown first', dialogs.length === 1, dialogs);
  check('ง month closed during confirm: nothing written', r.writes.length === 0 && r.bulkKeys.length === 0 && r.settingsSame && r.after['day:2026-10-08'] === undefined && r.after.debts === undefined, { w: r.writes, b: r.bulkKeys });
  check('ง clear message asks to retry', r.toast.includes('Oct 2026') && r.toast.includes('ลองนำเข้าใหม่'), r.toast);

  // จ) fileCM เป็น true → เขียนเป็น {at, dev} แบบแอป, รูปเพี้ยนอื่น (ตัวเลข/อาเรย์) ข้าม
  r = await run({ closedMonths: CM9 }, { settings: baseSettings, days: {}, debts: [], closedMonths: { '2026-08': true, '2026-07': 5, '2026-06': ['x'] } });
  const v8 = r.after.closedMonths && r.after.closedMonths['2026-08'];
  check('จ true normalized to {at, dev}', v8 && typeof v8 === 'object' && typeof v8.at === 'string' && !isNaN(Date.parse(v8.at)) && typeof v8.dev === 'string' && v8.dev.length > 0 && Object.keys(v8).sort().join() === 'at,dev', v8);
  check('จ malformed entries skipped, 09 kept', !('2026-07' in r.after.closedMonths) && !('2026-06' in r.after.closedMonths) && JSON.stringify(r.after.closedMonths['2026-09']) === JSON.stringify(CM9['2026-09']), r.after.closedMonths);
  check('จ only patchOps path [2026-08]', cmWrites(r).length === 1 && cmWrites(r)[0].op === 'patchOps' && JSON.stringify(cmWrites(r)[0].ops.map(o => o.path)) === '[["2026-08"]]', cmWrites(r));
  check('จ toast reports skipped malformed months', r.toast.includes('ข้ามเดือนปิดที่รูปไม่ถูก 2 รายการ'), r.toast);

  await page.setViewportSize({ width: 420, height: 900 });
  await finish(browser);
})();
