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
    function applyFieldOp(root, op){
      let node = root;
      for(let i=0;i<op.path.length-1;i++){ const k=op.path[i]; if(node[k]===undefined||node[k]===null||typeof node[k]!=='object') node[k]={}; node=node[k]; }
      const lastKey = op.path[op.path.length-1];
      if(op.deleteKey){ delete node[lastKey]; } else { node[lastKey]=op.value; }
    }
    function getArrayAt(root, arrayPath){
      let node = root;
      for(let i=0;i<arrayPath.length-1;i++){ const k=arrayPath[i]; if(node[k]===undefined||node[k]===null||typeof node[k]!=='object') node[k]={}; node=node[k]; }
      const lastKey = arrayPath[arrayPath.length-1];
      if(!Array.isArray(node[lastKey])) node[lastKey]=[];
      return node[lastKey];
    }
    function applyArrayOp(root, op){
      const arr = getArrayAt(root, op.arrayPath);
      if(op.push!==undefined){ arr.push(op.push); return; }
      if(op.remove){ const {matchField,matchValue,matchAll}=op.remove;
        if(matchAll){ for(let i=arr.length-1;i>=0;i--){ if(arr[i]&&arr[i][matchField]===matchValue) arr.splice(i,1); } }
        else { const idx=arr.findIndex(x=>x&&x[matchField]===matchValue); if(idx>=0) arr.splice(idx,1); }
        return; }
      if(op.set){ const item=arr.find(x=>x&&x[op.matchField]===op.matchValue); if(item) Object.assign(item, op.set); return; }
      if(op.nested){ const item=arr.find(x=>x&&x[op.matchField]===op.matchValue);
        if(item){ const subArr=item[op.nested.field]=item[op.nested.field]||[]; const subItem=subArr.find(x=>x&&x[op.nested.matchField]===op.nested.matchValue); if(subItem) Object.assign(subItem, op.nested.set); }
        return; }
    }
    window.storage = {
      async get(key){ if(!(key in window.__store)){ throw new Error('Key not found: '+key); } return {key, value: JSON.stringify(window.__store[key]), shared:false}; },
      async set(key, value){ window.__store[key]=JSON.parse(value); return {key, value: JSON.stringify(window.__store[key]), shared:false}; },
      async delete(key){ const existed = key in window.__store; delete window.__store[key]; return {key, deleted: existed, shared:false}; },
      async list(prefix){ return {keys: Object.keys(window.__store).filter(k=>k.startsWith(prefix||'')), prefix, shared:false}; },
      async patchField(key, path, value){ if(!(key in window.__store)) window.__store[key]={}; applyFieldOp(window.__store[key], {path, value}); return {key, value: JSON.stringify(window.__store[key]), shared:false}; },
      async patchOps(key, ops, rootIsArray){
        if(rootIsArray){ if(!Array.isArray(window.__store[key])) window.__store[key]=[]; } else { if(!(key in window.__store)) window.__store[key]={}; }
        const root = window.__store[key];
        const opsArr = Array.isArray(ops) ? ops : [ops];
        for(const op of opsArr){
          if(rootIsArray){ const wrapper={arr:root}; applyArrayOp(wrapper, Object.assign({}, op, {arrayPath:['arr'].concat(op.arrayPath||[])})); window.__store[key]=wrapper.arr; }
          else if(op.path){ applyFieldOp(root, op); }
          else if(op.arrayPath){ applyArrayOp(root, op); }
        }
        return {key, value: JSON.stringify(window.__store[key]), shared:false};
      }
    };
  });
}

function check(label, cond, extra) {
  const pass = !!cond;
  console.log((pass?'PASS':'FAIL') + ' — ' + label + (extra!==undefined ? ' | ' + JSON.stringify(extra) : ''));
  return pass;
}

(async () => {
  const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
  const page = await browser.newPage({ viewport: { width: 1335, height: 1000 } });
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  page.on('dialog', async d => { await d.accept(); });
  await page.goto((process.env.BASE_URL || 'http://localhost:8765') + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await stripBanner(page);
  await installMockStorage(page);
  await page.evaluate(() => switchTab('purchase'));
  await page.waitForTimeout(300);

  let allPass = true;

  // ---- Seed a 2-product-lot bill (ปูจืด p4 + เนื้อหอยนางรม p7), sharing billId, plus its lotProductBills/lotTransportBills ----
  await page.evaluate(() => {
    window.__store['rawLots'] = [
      { id:'lotCrab1', productId:'p4', seller:'ตลาดทะเลไทย', sellerNote:'เจ๊ตุ้ม', buyDate:'2026-09-20', qtyTotal:5, pricePerKg:150, extra:0, note:'', billId:'billX', draws:[] },
      { id:'lotOyster1', productId:'p7', seller:'ตลาดทะเลไทย', sellerNote:'เจ๊ตุ้ม', buyDate:'2026-09-20', qtyTotal:10, pricePerKg:160, extra:75, note:'', billId:'billX', draws:[] },
    ];
    window.__store['lotProductBills'] = [ { id:'lpbillX', billId:'billX', seller:'ตลาดทะเลไทย', sellerNote:'เจ๊ตุ้ม', buyDate:'2026-09-20', amount:2250, productLabel:'🦀ปูจืด 🐚เนื้อหอยนางรม', paid:false, paidDate:null } ];
    window.__store['lotTransportBills'] = [ { id:'ltbillX', billId:'billX', payee:'ขนส่งชุนพล', amount:100, buyDate:'2026-09-20', productLabel:'🦀ปูจืด 🐚เนื้อหอยนางรม', paid:false, paidDate:null } ];
    rawLotsCache_ = null; lotProductBillsCache_ = null; lotTransportBillsCache_ = null;
    currentDate = '2026-09-20';
  });

  // ---- Step 1: delete the FIRST lot (ปูจืด) — sibling (นางรม) still exists, bill must survive untouched ----
  await page.evaluate(() => { lotItemFoldOpenIds.add('lotCrab1'); lotItemFoldOpenIds.add('lotOyster1'); });
  await page.evaluate(async () => { await renderLotList(); });
  await page.waitForTimeout(200);
  await page.click('[data-lotdel="lotCrab1"]');
  await page.waitForTimeout(300);

  const afterFirstDelete = await page.evaluate(async () => {
    const lots = await loadRawLots();
    const productBills = await loadLotProductBills();
    const transportBills = await loadLotTransportBills();
    return {
      remainingLotIds: lots.map(l=>l.id),
      productBillStillExists: productBills.some(b=>b.billId==='billX'),
      transportBillStillExists: transportBills.some(b=>b.billId==='billX'),
    };
  });
  allPass &= check('Step1a: crab lot removed, oyster lot (sibling) untouched',
    JSON.stringify(afterFirstDelete.remainingLotIds) === JSON.stringify(['lotOyster1']), afterFirstDelete);
  allPass &= check('Step1b: lotProductBills for billX SURVIVES (sibling lot still exists)',
    afterFirstDelete.productBillStillExists === true, afterFirstDelete);
  allPass &= check('Step1c: lotTransportBills for billX SURVIVES (sibling lot still exists)',
    afterFirstDelete.transportBillStillExists === true, afterFirstDelete);

  // ---- Step 2: delete the LAST remaining lot (นางรม) — this is the exact orphan-triggering scenario ----
  await page.evaluate(async () => { await renderLotList(); });
  await page.waitForTimeout(200);
  await page.click('[data-lotdel="lotOyster1"]');
  await page.waitForTimeout(300);

  const afterSecondDelete = await page.evaluate(async () => {
    const lots = await loadRawLots();
    const productBills = await loadLotProductBills();
    const transportBills = await loadLotTransportBills();
    return {
      remainingLotIds: lots.map(l=>l.id),
      productBillOrphanGone: !productBills.some(b=>b.billId==='billX'),
      transportBillOrphanGone: !transportBills.some(b=>b.billId==='billX'),
    };
  });
  allPass &= check('Step2a: last lot (oyster) removed, no rawLots left for billX',
    afterSecondDelete.remainingLotIds.length === 0, afterSecondDelete);
  allPass &= check('Step2b: orphaned lotProductBills record CLEANED UP (this is the bug fix)',
    afterSecondDelete.productBillOrphanGone === true, afterSecondDelete);
  allPass &= check('Step2c: orphaned lotTransportBills record CLEANED UP',
    afterSecondDelete.transportBillOrphanGone === true, afterSecondDelete);

  // ---- Confirm the rendered UI reflects this correctly: no floating bill in the summary, nothing to show in ล็อตที่มีอยู่ ----
  const uiCheck = await page.evaluate(async () => {
    await renderLotProductBillList();
    const el = document.getElementById('lotProductBillList');
    return { billListHtml: el ? el.innerHTML : 'MISSING', mentionsBillX: el ? el.innerHTML.includes('2,250') : null };
  });
  allPass &= check('UI: "บิลสินค้าล็อต" no longer shows the ฿2,250 floating bill', uiCheck.mentionsBillX === false, uiCheck);

  // ---- Regression: deleteWholeBill() still works normally on a fresh bill (both product lines + bills removed together) ----
  await page.evaluate(() => {
    window.__store['rawLots'] = [
      { id:'lotCrab2', productId:'p4', seller:'มนต์', sellerNote:'', buyDate:'2026-09-20', qtyTotal:5, pricePerKg:150, extra:0, note:'', billId:'billY', draws:[] },
      { id:'lotOyster2', productId:'p7', seller:'มนต์', sellerNote:'', buyDate:'2026-09-20', qtyTotal:10, pricePerKg:160, extra:0, note:'', billId:'billY', draws:[] },
    ];
    window.__store['lotProductBills'] = [ { id:'lpbillY', billId:'billY', seller:'มนต์', sellerNote:'', buyDate:'2026-09-20', amount:1550, productLabel:'🦀ปูจืด 🐚เนื้อหอยนางรม', paid:false, paidDate:null } ];
    window.__store['lotTransportBills'] = [];
    rawLotsCache_ = null; lotProductBillsCache_ = null; lotTransportBillsCache_ = null;
  });
  const regressionResult = await page.evaluate(async () => {
    await deleteWholeBill('billY');
    const lots = await loadRawLots();
    const productBills = await loadLotProductBills();
    return { remainingLots: lots.filter(l=>l.billId==='billY').length, remainingBills: productBills.filter(b=>b.billId==='billY').length };
  });
  allPass &= check('Regression: deleteWholeBill() still removes both lots and the bill together',
    regressionResult.remainingLots === 0 && regressionResult.remainingBills === 0, regressionResult);

  console.log('\n=== SUMMARY ===');
  console.log(allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED');
  await browser.close();
  process.exit(allPass ? 0 : 1);
})();
