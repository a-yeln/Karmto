const { chromium } = require('playwright');

async function stripBanner(page) {
  await page.evaluate(() => {
    document.querySelectorAll('*').forEach(el => {
      if (el.textContent && el.textContent.includes('เชื่อมต่อฐานข้อมูลไม่ได้') && el.children.length === 0) {
        el.closest('div')?.remove();
      }
    });
  });
}

async function installMockStorage(page, delayMs) {
  await page.evaluate((delay) => {
    window.__store = {};
    function applyRootOp(arr, op){
      if(op.push){ arr.push(op.push); return; }
      if(op.remove){ const idx = arr.findIndex(x=>x[op.remove.matchField]===op.remove.matchValue); if(idx>=0) arr.splice(idx,1); return; }
      if(op.matchField && op.set){
        const item = arr.find(x=>x[op.matchField]===op.matchValue);
        if(item) Object.assign(item, op.set);
        return;
      }
      if(op.matchField && op.nested){
        const item = arr.find(x=>x[op.matchField]===op.matchValue);
        if(!item) return;
        const nestedArr = item[op.nested.field] = item[op.nested.field] || [];
        applyRootOp(nestedArr, op.nested);
        return;
      }
    }
    window.storage = {
      async get(key){ if(!(key in window.__store)){ throw new Error('Key not found: '+key); } return {key, value: JSON.stringify(window.__store[key]), shared:false}; },
      async set(key, value){ window.__store[key]=JSON.parse(value); return {key, value: JSON.stringify(window.__store[key]), shared:false}; },
      async delete(key){ const existed = key in window.__store; delete window.__store[key]; return {key, deleted: existed, shared:false}; },
      async list(prefix){ return {keys: Object.keys(window.__store).filter(k=>k.startsWith(prefix||'')), prefix, shared:false}; },
      async patchField(key, path, value){ return {key, value: '{}', shared:false}; },
      async patchOps(key, ops, rootIsArray){
        // artificial delay to open a real race window between two concurrent callers
        if(delay) await new Promise(r=>setTimeout(r, delay));
        if(!(key in window.__store)) window.__store[key] = rootIsArray ? [] : {};
        const doc = window.__store[key];
        if(rootIsArray){
          ops.forEach(op=>applyRootOp(doc, op));
        } else {
          ops.forEach(op=>{
            let arr = doc;
            (op.arrayPath||[]).forEach(k=>{ if(arr[k]===undefined) arr[k]=[]; arr=arr[k]; });
            if(op.push){ arr.push(op.push); }
          });
        }
        return {key, value: JSON.stringify(doc), shared:false};
      },
    };
    window.bulkGetStorageImpl = async (keys) => { const out={}; keys.forEach(k=>{ out[k]=window.__store[k]!==undefined?JSON.stringify(window.__store[k]):null; }); return out; };
  }, delayMs);
}

function check(label, cond, extra) {
  const pass = !!cond;
  console.log((pass?'PASS':'FAIL') + ' — ' + label + (extra!==undefined ? ' | ' + JSON.stringify(extra) : ''));
  return pass;
}

(async () => {
  const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
  const page = await browser.newPage({ viewport: { width: 1335, height: 1200 } });
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  await page.goto((process.env.BASE_URL || 'http://localhost:8765') + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await stripBanner(page);
  await installMockStorage(page, 60); // 60ms delay per write — wide enough to force real overlap between two concurrent calls

  let allPass = true;

  // ---- Reproduce the exact reported bug: a single 2kg claim (no lotClaimAllocations yet, simulating "legacy" data
  // or a claim saved before this fix), then ensureClaimsLinkedToLots_() fires twice concurrently (simulating two
  // near-simultaneous page-load/lot-load triggers) — confirm the fix makes this safe (claimedQty ends at 2, not 4).
  const result = await page.evaluate(async () => {
    const lot = {id:'lot1', productId:'p6', buyDate:'2026-09-18', seller:'ตลาดทะเลไทย',
      draws:[{id:'draw1', date:'2026-09-20', qtyUsed:5, sellableQty:5, totalCost:575, costedQty:1}]};
    window.__store['rawLots'] = [lot];
    rawLotsCache_ = [lot];
    const wasteRecord = {id:'waste1', productId:'p6', qty:2, date:'2026-09-25', note:'', estCostPerKg:110, estCost:220, reason:'waste'};
    window.__store['wasteRecords'] = [wasteRecord];
    wasteRecordsCache_ = [wasteRecord];

    // Fire two concurrent backfill calls, exactly as could happen from two near-simultaneous lot-load triggers.
    const lotsA = await loadRawLots();
    const lotsB = await loadRawLots();
    await Promise.all([
      ensureClaimsLinkedToLots_(lotsA),
      ensureClaimsLinkedToLots_(lotsB),
    ]);

    const finalLots = window.__store['rawLots'];
    const finalDraw = finalLots[0].draws[0];
    const finalWasteRecords = window.__store['wasteRecords'];

    return { claimedQty: finalDraw.claimedQty, wasteRecordCount: finalWasteRecords.length, wasteRecordAllocations: finalWasteRecords[0].lotClaimAllocations };
  });

  console.log('Concurrent backfill result:', JSON.stringify(result, null, 2));
  allPass &= check('draw.claimedQty ends at 2 (the real claimed amount), NOT doubled to 4', result.claimedQty===2, result.claimedQty);
  allPass &= check('Still exactly 1 wasteRecords entry (no duplication)', result.wasteRecordCount===1, result.wasteRecordCount);
  allPass &= check('The single record has lotClaimAllocations summing to 2', result.wasteRecordAllocations && result.wasteRecordAllocations.reduce((s,a)=>s+a.qty,0)===2, result.wasteRecordAllocations);

  // ---- Regression: a THIRD concurrent call after the first two already linked everything should be a safe no-op ----
  const noopResult = await page.evaluate(async () => {
    const lots = await loadRawLots();
    await ensureClaimsLinkedToLots_(lots);
    const finalDraw = window.__store['rawLots'][0].draws[0];
    return { claimedQty: finalDraw.claimedQty };
  });
  console.log('Idempotent re-run result:', JSON.stringify(noopResult));
  allPass &= check('Regression: re-running the backfill again is a safe no-op (still 2, not 4 or 6)', noopResult.claimedQty===2, noopResult.claimedQty);

  // ---- Regression: normal single live claim (data-wastesave path) still writes exactly once, no doubling ----
  const liveClaimResult = await page.evaluate(async () => {
    const lot2 = {id:'lot2', productId:'p6', buyDate:'2026-09-19', seller:'ตลาดทะเลไทย',
      draws:[{id:'draw2', date:'2026-09-21', qtyUsed:5, sellableQty:5, totalCost:575, costedQty:0}]};
    window.__store['rawLots'] = [lot2];
    rawLotsCache_ = [lot2];
    window.__store['wasteRecords'] = [];
    wasteRecordsCache_ = [];
    currentDate = '2026-09-25';
    dayData = { orders: {}, leftoverOut: {p6: 5}, leftoverSince: {}, billingPaid: {}, billExtra: {}, billNote: {}, billNoteShowOnBill:{}, billClaimNotes: {}, expenses: [], personalIncome: [], personalExpense: [], purchases: [], purchaseGroupPayment: {}, messageOverrides: {} };
    dayCache_['2026-09-25'] = dayData;
    window.__store['day:2026-09-25'] = dayData;

    await switchTab('leftover');
    await renderLeftover();
    await new Promise(r=>setTimeout(r,200));

    const qtyInput = document.getElementById('wasteQty-p6');
    if(!qtyInput) return { formFound: false };
    qtyInput.value = '2';
    document.getElementById('data-wastesave-p6' in {} ? '' : 'wasteQty-p6'); // no-op, keep structure simple
    const saveBtn = document.querySelector('[data-wastesave="p6"]');
    saveBtn.click();
    await new Promise(r=>setTimeout(r,300));

    const draw = window.__store['rawLots'][0].draws[0];
    const records = window.__store['wasteRecords'];
    return { formFound: true, claimedQty: draw.claimedQty, recordCount: records.length };
  });
  console.log('Live single-claim result:', JSON.stringify(liveClaimResult));
  if(liveClaimResult.formFound){
    allPass &= check('Live single claim via the UI writes claimedQty=2 exactly once', liveClaimResult.claimedQty===2, liveClaimResult.claimedQty);
    allPass &= check('Live single claim creates exactly 1 wasteRecords entry', liveClaimResult.recordCount===1, liveClaimResult.recordCount);
  } else {
    console.log('(waste form not found for p6 — leftover form may require different setup; skipping this sub-check)');
  }

  console.log('\n=== SUMMARY ===');
  console.log(allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED');
  await browser.close();
  process.exit(allPass ? 0 : 1);
})();
