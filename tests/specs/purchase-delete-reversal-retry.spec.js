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

async function installMockStorage(page) {
  await page.evaluate(() => {
    window.__store = {};
    window.__rawLotsFailuresLeft = 0; // how many times the NEXT patchOps('rawLots',...) calls should fail
    function getArrayAt(root, arrayPath){ let node=root; for(let i=0;i<arrayPath.length-1;i++){ const k=arrayPath[i]; if(node[k]===undefined) node[k]={}; node=node[k]; } const lastKey=arrayPath[arrayPath.length-1]; if(!Array.isArray(node[lastKey])) node[lastKey]=[]; return node[lastKey]; }
    function applyArrayOp(root, op){
      const arr = getArrayAt(root, op.arrayPath);
      if(op.push!==undefined){ arr.push(op.push); return; }
      if(op.remove){ const {matchField,matchValue,matchAll}=op.remove; if(matchAll){ for(let i=arr.length-1;i>=0;i--){ if(arr[i]&&arr[i][matchField]===matchValue) arr.splice(i,1); } } else { const idx=arr.findIndex(x=>x&&x[matchField]===matchValue); if(idx>=0) arr.splice(idx,1); } return; }
      if(op.nested){ const item=arr.find(x=>x&&x[op.matchField]===op.matchValue); if(item){ const subArr=item[op.nested.field]=item[op.nested.field]||[]; const subItem=subArr.find(x=>x&&x[op.nested.matchField]===op.nested.matchValue); if(subItem) Object.assign(subItem, op.nested.set); } return; }
    }
    window.storage = {
      async get(key){ if(!(key in window.__store)){ throw new Error('Key not found: '+key); } return {key, value: JSON.stringify(window.__store[key]), shared:false}; },
      async set(key, value){ window.__store[key]=JSON.parse(value); return {key, value: JSON.stringify(window.__store[key]), shared:false}; },
      async delete(key){ const existed = key in window.__store; delete window.__store[key]; return {key, deleted: existed, shared:false}; },
      async list(prefix){ return {keys: Object.keys(window.__store).filter(k=>k.startsWith(prefix||'')), prefix, shared:false}; },
      async patchField(key, path, value){ return {key, value: '{}', shared:false}; },
      async patchOps(key, ops, rootIsArray){
        if(key==='rawLots' && window.__rawLotsFailuresLeft>0){ window.__rawLotsFailuresLeft--; throw new Error('simulated flaky network'); }
        if(rootIsArray){ if(!Array.isArray(window.__store[key])) window.__store[key]=[]; } else { if(!(key in window.__store)) window.__store[key]={}; }
        const root = window.__store[key];
        const opsArr = Array.isArray(ops) ? ops : [ops];
        opsArr.forEach(op=>{
          if(rootIsArray){ const wrapper={arr:root}; applyArrayOp(wrapper, Object.assign({}, op, {arrayPath:['arr'].concat(op.arrayPath||[])})); window.__store[key]=wrapper.arr; }
          else if(op.arrayPath){ applyArrayOp(root, op); }
        });
        return {key, value: JSON.stringify(window.__store[key]), shared:false};
      },
    };
    window.bulkGetStorageImpl = async (keys) => { const out={}; keys.forEach(k=>{ out[k]=window.__store[k]!==undefined?JSON.stringify(window.__store[k]):null; }); return out; };
  });
}

function check(label, cond, extra) {
  const pass = !!cond;
  console.log((pass?'PASS':'FAIL') + ' — ' + label + (extra!==undefined ? ' | ' + JSON.stringify(extra) : ''));
  return pass;
}

function seed(){
  const lot = { id:'lotPJ', productId:'p4', seller:'เจ๊ตุ้ม', sellerNote:'', buyDate:'2026-09-21', qtyTotal:5, pricePerKg:135, extra:0, note:'', billId:'lotPJ',
    draws:[ { id:'drawPJb', date:'2026-09-22', qtyUsed:1, sellableQty:0.1, totalCost:15, costedQty:0.1 } ]};
  return lot;
}

(async () => {
  const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
  const page = await browser.newPage({ viewport: { width: 1335, height: 1200 } });
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  page.on('dialog', async d => { await d.accept(); });
  await page.goto((process.env.BASE_URL || 'http://localhost:8765') + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await stripBanner(page);
  await installMockStorage(page);
  await page.evaluate(() => switchTab('purchase'));
  await page.waitForTimeout(300);

  let allPass = true;

  // Scenario 1: the rawLots reversal write fails TWICE (transient network blips) then succeeds on the 3rd try —
  // deleting should still end up fully consistent (purchase gone AND costedQty correctly reversed), no manual toast needed.
  const result1 = await page.evaluate(async (lotFactoryStr) => {
    // สำคัญ: ออเดอร์วันนั้นครบ 5 แล้วจากรายการอื่น (3+2) — ตรงตามสถานการณ์จริงที่ผู้ใช้รายงาน (ปูจืดครบ 5 โลตามออเดอร์แล้ว)
    // ไม่ใช่ตั้งออเดอร์ให้พอดีกับรายการ 0.1 ที่กำลังจะลบ (แบบนั้นถือเป็นพฤติกรรมถูกต้องที่ต้องตัดกลับมาใหม่ ไม่ใช่บั๊ก)
    const lot = { id:'lotPJ', productId:'p4', seller:'เจ๊ตุ้ม', sellerNote:'', buyDate:'2026-09-21', qtyTotal:5, pricePerKg:135, extra:0, note:'', billId:'lotPJ',
      draws:[ { id:'drawPJb', date:'2026-09-22', qtyUsed:1, sellableQty:0.1, totalCost:15, costedQty:0.1 } ]};
    rawLotsCache_ = [lot];
    window.__store['rawLots'] = [lot];
    currentDate = '2026-09-22';
    const entryManual3 = {id:'puManual3', productId:'p4', seller:'มนต์', qty:3, price:150, extra:0, sellableQty:3, paid:true, fromLot:false, note:''};
    const entryLot2 = {id:'puLot2', productId:'p4', seller:'เจ๊ตุ้ม', qty:2, price:135, extra:0, sellableQty:2, paid:true, fromLot:true, lotSettle:true, note:'', lotSettleAllocations:[{lotId:'lotPJ', drawId:'drawPJa_placeholder', qty:2, cost:270}]};
    const entry01 = {id:'puLot01', productId:'p4', seller:'เจ๊ตุ้ม', qty:1, price:15, extra:0, sellableQty:0.1, paid:true, fromLot:true, lotSettle:true, note:'', lotSettleAllocations:[{lotId:'lotPJ', drawId:'drawPJb', qty:0.1, cost:15}]};
    dayData = { orders: {b1:{p4:5}}, leftoverOut: {}, leftoverSince: {}, billingPaid: {}, billExtra: {}, billNote: {}, billClaimNotes: {}, expenses: [], personalIncome: [], personalExpense: [], purchases: [entryManual3, entryLot2, entry01], purchaseGroupPayment: {}, messageOverrides: {} };
    dayCache_['2026-09-22'] = dayData;
    window.__store['day:2026-09-22'] = dayData;
    dayCache_['2026-09-21'] = { orders: {}, leftoverOut: {}, leftoverSince: {}, billingPaid: {}, billExtra: {}, billNote: {}, billClaimNotes: {}, expenses: [], personalIncome: [], personalExpense: [], purchases: [], purchaseGroupPayment: {}, messageOverrides: {} };

    let lastToast = null;
    const origToast = window.showToast;
    window.showToast = (msg) => { lastToast = msg; return origToast ? origToast(msg) : undefined; };

    window.__rawLotsFailuresLeft = 2; // fail twice, succeed on 3rd attempt

    await renderPurchaseList();
    const delBtn = document.querySelector('[data-purchdel="puLot01"]');
    delBtn.click();
    await new Promise(r=>setTimeout(r, 3500)); // allow the 1s+2s backoff retries to finish

    const drawB = rawLotsCache_[0].draws.find(d=>d.id==='drawPJb');
    return { costedQtyAfter: drawB.costedQty, purchasesCount: (dayData.purchases||[]).length, lastToast };
  });
  console.log('Result 1 (2 transient failures, 3rd succeeds):', JSON.stringify(result1, null, 2));
  allPass &= check('Retry recovers from 2 transient failures — costedQty correctly reversed to 0', result1.costedQtyAfter === 0, result1.costedQtyAfter);
  allPass &= check('Purchase entry stays deleted (2 remain: the manual 3kg + lot 2kg — matching the order exactly)', result1.purchasesCount === 2, result1.purchasesCount);
  allPass &= check('No scary "failed" toast shown once retry succeeds', !result1.lastToast || !result1.lastToast.includes('ไม่สำเร็จ'), result1.lastToast);
  allPass &= check('CRITICAL: order already fully matched (5) — the deleted 0.1kg entry must NOT get silently re-created by auto-settle', result1.purchasesCount === 2, result1.purchasesCount);

  // Scenario 2: the rawLots reversal write fails ALL 3 attempts (persistent outage) — should show the clearer toast
  // explaining this is expected/self-healing via the audit, not a mystery duplicate bug.
  const result2 = await page.evaluate(async () => {
    const lot = { id:'lotPJ2', productId:'p4', seller:'เจ๊ตุ้ม', sellerNote:'', buyDate:'2026-09-21', qtyTotal:5, pricePerKg:135, extra:0, note:'', billId:'lotPJ2',
      draws:[ { id:'drawPJc', date:'2026-09-22', qtyUsed:1, sellableQty:0.1, totalCost:15, costedQty:0.1 } ]};
    rawLotsCache_ = [lot];
    window.__store['rawLots'] = [lot];
    currentDate = '2026-09-22';
    const entry01 = {id:'puLot01b', productId:'p4', seller:'เจ๊ตุ้ม', qty:1, price:15, extra:0, sellableQty:0.1, paid:true, fromLot:true, lotSettle:true, note:'', lotSettleAllocations:[{lotId:'lotPJ2', drawId:'drawPJc', qty:0.1, cost:15}]};
    dayData = { orders: {b1:{p4:0.1}}, leftoverOut: {}, leftoverSince: {}, billingPaid: {}, billExtra: {}, billNote: {}, billClaimNotes: {}, expenses: [], personalIncome: [], personalExpense: [], purchases: [entry01], purchaseGroupPayment: {}, messageOverrides: {} };
    dayCache_['2026-09-22'] = dayData;
    window.__store['day:2026-09-22'] = dayData;

    let lastToast = null;
    const origToast = window.showToast;
    window.showToast = (msg) => { lastToast = msg; return origToast ? origToast(msg) : undefined; };

    window.__rawLotsFailuresLeft = 99; // always fail

    await renderPurchaseList();
    const delBtn = document.querySelector('[data-purchdel="puLot01b"]');
    delBtn.click();
    await new Promise(r=>setTimeout(r, 3500));

    const drawC = rawLotsCache_[0].draws.find(d=>d.id==='drawPJc');
    return { costedQtyAfter: drawC.costedQty, purchasesCount: (dayData.purchases||[]).length, lastToast };
  });
  console.log('Result 2 (persistent failure):', JSON.stringify(result2, null, 2));
  allPass &= check('Persistent failure: purchase still deleted (already committed)', result2.purchasesCount === 0, result2.purchasesCount);
  allPass &= check('Persistent failure: costedQty stays un-reversed (expected — audit will self-heal it)', result2.costedQtyAfter === 0.1, result2.costedQtyAfter);
  allPass &= check('Toast clearly explains this is not a mystery duplicate, and self-heals via the audit', result2.lastToast && result2.lastToast.includes('ไม่ใช่บั๊กซ้ำ'), result2.lastToast);

  console.log('\n=== SUMMARY ===');
  console.log(allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED');
  await browser.close();
  process.exit(allPass ? 0 : 1);
})();
