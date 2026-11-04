const { launch, mkDay, openApp, makeChecker } = require('../helpers');

// เก็บผลรีเช็คแยกคีย์ (ไม่โตจนเกินขนาดช่องของ Sheets), อ่านของเก่ารวมให้, และเตือนเมื่อข้อมูลคีย์ใดใกล้เต็ม
(async () => {
  const browser = await launch();
  const { check, finish } = makeChecker();
  const store = {
    ['day:2026-10-20']: mkDay({}),
    billingRecheckHistory: [{ id: 'old1', startedAt: '2026-09-01T00:00:00Z', clearedAt: '2026-09-02T00:00:00Z', items: [{ key: '2026-08-01|01', iso: '2026-08-01', code: '01', amt: 100, result: 'still_unpaid' }] }],
    billingRecheckCurrent: { startedAt: '2026-10-01T00:00:00Z', marks: { '2026-09-10|02': { key: '2026-09-10|02', iso: '2026-09-10', code: '02', amt: 50, result: 'found_paid' } } },
  };
  const page = await openApp(browser, { store, date: '2026-10-20' });

  const r = await page.evaluate(async () => {
    billingRecheckCurrentCache_ = null; billingRecheckHistoryCache_ = null;
    for(let i = 0; i < 250; i++){
      const iso = '2026-10-' + String(1 + (i % 28)).padStart(2, '0');
      const key = iso + '|' + String(i).padStart(3, '0');
      await writeBillingRecheckMark_(key, { key, iso, code: String(i), amt: 1000 + i, checkedAt: new Date().toISOString(), note: 'ทดสอบโน้ตยาวๆ สำหรับวัดขนาดข้อมูลต่อรายการ', result: i % 2 ? 'found_paid' : 'still_unpaid' });
    }
    billingRecheckCurrentCache_ = null;
    const cur = await loadBillingRecheckCurrent();
    const markKeys = Object.keys(window.__store).filter(k => k.startsWith('rchkm:'));
    const curSize = JSON.stringify(window.__store.billingRecheckCurrent).length;
    await clearBillingRecheckRound_();
    await new Promise(res => setTimeout(res, 300));
    billingRecheckHistoryCache_ = null;
    const hist = await loadBillingRecheckHistory();
    const roundKeys = Object.keys(window.__store).filter(k => k.startsWith('rchk:'));
    const biggest = Math.max(...roundKeys.map(k => JSON.stringify(window.__store[k]).length));
    return { marks: Object.keys(cur.marks).length, markKeys: markKeys.length, curSize, hist: hist.map(h => [h.id === 'old1' ? 'old' : 'new', h.items.length]), roundKeys: roundKeys.length, biggest,
      marksLeft: Object.keys(window.__store).filter(k => k.startsWith('rchkm:')).length };
  });
  check('Each recheck mark is its own small key; legacy marks still read', r.marks === 251 && r.markKeys === 250 && r.curSize < 2000, r);
  check('Closed round is stored in chunks, each well under the cell limit; old history still shown', JSON.stringify(r.hist) === '[["old",1],["new",251]]' && r.roundKeys === 3 && r.biggest < 30000, r);
  check('Per-bill marks of the closed round are cleaned up', r.marksLeft === 0, r.marksLeft);

  const warn = await page.evaluate(async () => {
    await window.storage.set('bigThing', JSON.stringify('x'.repeat(43000)));
    await switchTab('noti');
    return { listed: document.getElementById('dataGapsList').textContent.includes('ข้อมูลใกล้เต็ม: bigThing'), badge: document.getElementById('notiBadge').textContent };
  });
  check('A key over 42,000 characters shows a "nearly full" warning in Notifications', warn.listed && Number(warn.badge) >= 1, warn);

  await finish(browser);
})();
