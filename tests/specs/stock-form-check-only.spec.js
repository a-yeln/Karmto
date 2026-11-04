const { launch, mkDay, openApp, makeChecker } = require('../helpers');

// ฟอร์มจดสต๊อก (ก่อนติ๊กกรอกครบ): ดึงข้อมูลเดิมมาใส่, คำนวณยอดคงเหลือต่อเนื่อง, ตรวจจุดผิด, ดูสิ่งที่จะเปลี่ยน
// — และต้องไม่เขียนทับข้อมูลจริง (day:/rawLots/lotProductBills/wasteRecords) เลยแม้แต่ครั้งเดียว
(async () => {
  const browser = await launch();
  const { check, finish } = makeChecker();
  const d1 = '2026-10-10', d2 = '2026-10-11';
  const store = {
    ['day:2026-10-09']: mkDay({ leftoverOut: { p1: 2 } }),
    ['day:' + d1]: mkDay({ orders: { '01': { p1: 5 } }, purchases: [{ id: 'pu1', productId: 'p1', qty: 4, price: 180, seller: 'มนต์', paid: false }] }),
    ['day:' + d2]: mkDay({ orders: { '01': { p1: 3 } } }),
  };
  const page = await openApp(browser, { store, date: d2, viewport: { width: 1024, height: 1200 } });
  await page.evaluate(() => { window.__writes.length = 0; });

  await page.evaluate(async () => { await switchTab('stockform'); });
  check('Stock Form menu sits right after Purchases', await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('.dash-wide-nav [data-tab]')].map(b => b.getAttribute('data-tab'));
    return tabs.indexOf('stockform') === tabs.indexOf('purchase') + 1;
  }));
  await page.evaluate(([a, b]) => { document.getElementById('sfFromNew').value = a; document.getElementById('sfToNew').value = b; document.getElementById('sfStartBtn').click(); }, [d1, d2]);
  await page.waitForFunction(() => !!document.getElementById('sfBody') && document.getElementById('sfBody').innerHTML.length > 0, null, { timeout: 15000 });

  const imported = await page.evaluate(d => (sfDraft.days[d].p1.fresh || []).map(l => [l.qty, l.price]), d1);
  check('Existing purchases are pulled into the form', JSON.stringify(imported) === '[[4,180]]', imported);

  const comp = await page.evaluate(([a, b]) => { const c = sfCompute_(); return { o1: c.res[a].p1.open, c1: c.res[a].p1.close, c2: c.res[b].p1.close, errs: c.errors.filter(e => e.pid === 'p1').map(e => e.iso + ':' + e.msg) }; }, [d1, d2]);
  // ยกมา 2 + ซื้อ 4 − ส่ง 5 = 1 ; วันถัดไป 1 + 0 − 3 = −2 (ต้องแจ้งเตือนติดลบ)
  check('Running balance carries over day to day', comp.o1 === 2 && comp.c1 === 1 && comp.c2 === -2, comp);
  check('Negative balance is flagged as an error', comp.errs.some(m => m.startsWith(d2) && m.includes('ติดลบ')), comp.errs);

  // แก้ให้ถูก (วันที่สองซื้อเพิ่ม 3 กก.) แล้วกดซิงค์ — ยังไม่ติ๊ก "กรอกครบ" วันไหน จึงต้องยังไม่เขียนอะไรลงระบบ
  await page.evaluate(d => { sfCell(d, 'p1').fresh.push({ lineId: 'x1', seller: 'มนต์', qty: 3, price: 185, yield: '', extra: 0, note: '', paid: false }); sfRenderBody_(); }, d2);
  await page.evaluate(() => document.getElementById('sfCheckBtn').click());
  await page.waitForFunction(() => /ยังไม่มีวันที่ติ๊ก|ยังซิงค์ไม่ได้/.test(document.getElementById('sfPreview').textContent), null, { timeout: 20000 });
  const pv = await page.evaluate(() => ({ text: document.getElementById('sfPreview').textContent, applyBtn: !!document.getElementById('sfApplyBtn') }));
  check('Without ticking days as complete, sync offers nothing to write', pv.text.includes('ยังไม่มีวันที่ติ๊ก') && !pv.applyBtn, pv.text.slice(0, 160));

  await page.waitForTimeout(1800);
  const writes = await page.evaluate(() => window.__writes.map(w => w.key || '').filter(k => k !== 'stockFormDraft' && !k.startsWith('actlog:') && k !== 'dayRevs'));
  const data = await page.evaluate(d => ({ purchases: window.__store['day:' + d].purchases.length }), d2);
  check('Nothing but the draft is written — real data untouched', writes.length === 0 && data.purchases === 0, { writes, data });
  check('Draft is saved to its own key', await page.evaluate(() => !!window.__store.stockFormDraft));

  // เคลมต้องหักออกจากสต๊อกของเหลือด้วย (แยกช่องจากของเสีย ดึงจากรายการเคลมจริง ไม่นับซ้ำ)
  const store2 = {
    ['day:2026-10-09']: mkDay({ leftoverOut: { p1: 3 } }),
    ['day:' + d1]: mkDay({ orders: { '01': { p1: 2 } } }),
    wasteRecords: [
      { id: 'w1', productId: 'p1', qty: 0.5, date: d1, reason: 'waste' },
      { id: 'c1', productId: 'p1', qty: 1, date: d1, reason: 'claim' },
    ],
  };
  const page2 = await openApp(browser, { store: store2, date: d1, viewport: { width: 1024, height: 1200 } });
  await page2.evaluate(async () => { localStorage.removeItem('karmto_stockform_draft'); await switchTab('stockform'); });
  await page2.evaluate(a => { document.getElementById('sfFromNew').value = a; document.getElementById('sfToNew').value = a; document.getElementById('sfStartBtn').click(); }, d1);
  await page2.waitForFunction(() => !!document.querySelector('#sfBody .sf-claim'), null, { timeout: 15000 });
  const cl = await page2.evaluate(a => { const r = sfCompute_().res[a].p1; return { waste: r.waste, claim: r.claim, close: r.close, shown: document.querySelector('#sfBody [data-sfcard$="|p1"] .sf-claim').textContent, formula: document.querySelector('[data-sfout="formula|' + a + '|p1"]').textContent }; }, d1);
  // ยกมา 3 − ส่ง 2 − เสีย 0.5 − เคลม 1 = −0.5
  check('Claims are split from waste and both reduce stock', cl.waste === 0.5 && cl.claim === 1 && cl.close === -0.5 && cl.shown === '1' && cl.formula.includes('เคลม 1'), cl);
  check('Claim field is read-only (comes from real claim records)', await page2.evaluate(() => !document.querySelector('#sfBody input[data-sfc]')));
  await page2.close();

  await finish(browser);
})();
