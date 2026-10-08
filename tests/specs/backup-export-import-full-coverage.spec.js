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
    window.storage = {
      async get(key){ if(!(key in window.__store)){ throw new Error('Key not found: '+key); } return {key, value: JSON.stringify(window.__store[key]), shared:false}; },
      async set(key, value){ window.__store[key]=JSON.parse(value); return {key, value: JSON.stringify(window.__store[key]), shared:false}; },
      async delete(key){ delete window.__store[key]; return {key, deleted:true, shared:false}; },
      async list(prefix){ return {keys: Object.keys(window.__store).filter(k=>k.startsWith(prefix||'')), prefix, shared:false}; },
      async patchField(key, path, value){
        let root = window.__store[key]; if(root === undefined) root = {}; root = JSON.parse(JSON.stringify(root));
        let target = root; for(let i=0;i<path.length-1;i++){ const seg=path[i]; if(target[seg]===undefined) target[seg]={}; target=target[seg]; }
        if(path.length>0) target[path[path.length-1]] = value;
        window.__store[key] = root; return {key, value: JSON.stringify(root), shared:false};
      },
      async patchOps(key, ops, rootIsArray){ return {key, value: JSON.stringify(window.__store[key]||(rootIsArray?[]:{})), shared:false}; },
    };
    window.bulkGetStorageImpl = async (keys) => { const out={}; keys.forEach(k=>{ out[k]=window.__store[k]!==undefined?JSON.stringify(window.__store[k]):null; }); return out; };
    window.bulkSetStorageImpl = async (items) => { items.forEach(it=>{ window.__store[it.key]=JSON.parse(it.value); }); return {ok:true}; };
  });
}

function check(label, cond, extra) {
  const pass = !!cond;
  console.log((pass?'PASS':'FAIL') + ' — ' + label + (extra!==undefined ? ' | ' + JSON.stringify(extra) : ''));
  return pass;
}

(async () => {
  const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  await page.goto((process.env.BASE_URL || 'http://localhost:8765') + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await stripBanner(page);
  await installMockStorage(page);

  let allPass = true;

  // Seed every root key the app actually uses (beyond settings/days/debts) so the export can be checked for completeness
  await page.evaluate(async () => {
    window.__store['day:2026-10-08'] = { orders:{}, leftoverOut:{}, leftoverSince:{}, billingPaid:{}, billExtra:{}, billNote:{}, billNoteShowOnBill:{}, billClaimNotes:{}, expenses:[], personalIncome:[], personalExpense:[], purchases:[], purchaseGroupPayment:{}, messageOverrides:{}, feeNote:'', dashNote:'' };
    window.__store['debts'] = [{id:'d1', amount:100}];
    window.__store['rawLots'] = [{id:'lot1', productId:'p7'}];
    window.__store['lotProductBills'] = [{id:'b1', billId:'bill1'}];
    window.__store['lotTransportBills'] = [{id:'t1', billId:'bill1'}];
    window.__store['wasteRecords'] = [{id:'w1', qty:4}];
    window.__store['activityLog'] = [{id:'a1', action:'test'}];
    window.__store['billingRecheckCurrent'] = { marks: { 'x': {result:'found_paid'} } };
    window.__store['billingRecheckHistory'] = [{startedAt:'2026-10-01T00:00:00Z'}];
    window.__store['supplierShortfalls'] = [{id:'s1', productId:'p1'}];
    currentDate = '2026-10-08'; dayData = window.__store['day:2026-10-08']; dayCache_['2026-10-08'] = dayData;
  });

  // ===== Test 1: exportAllData() captures every root key, not just settings/days/debts =====
  const exported = await page.evaluate(async () => {
    const orig = URL.createObjectURL;
    let capturedBlobText = null;
    URL.createObjectURL = (blob) => { return 'blob:captured'; };
    const origReadBlobText = Blob.prototype.text;
    // แอบดักจับ JSON ที่ exportAllData() กำลังจะสร้างไฟล์ดาวน์โหลด โดยอ่านจาก Blob ที่ถูกสร้างขึ้นผ่าน constructor แทน
    const OrigBlob = window.Blob;
    window.Blob = function(parts, opts){ capturedBlobText = parts[0]; return new OrigBlob(parts, opts); };
    await exportAllData();
    window.Blob = OrigBlob;
    URL.createObjectURL = orig;
    return JSON.parse(capturedBlobText);
  });
  console.log('Exported payload top-level keys:', Object.keys(exported).sort());
  const expectedKeys = ['activityLog','billingRecheckCurrent','billingRecheckHistory','days','debts','exportedAt','lotProductBills','lotTransportBills','rawLots','settings','supplierShortfalls','wasteRecords'];
  allPass &= check('Export payload has all expected root keys', expectedKeys.every(k=>Object.keys(exported).includes(k)), Object.keys(exported).sort());
  allPass &= check('rawLots captured correctly', JSON.stringify(exported.rawLots) === JSON.stringify([{id:'lot1', productId:'p7'}]), exported.rawLots);
  allPass &= check('wasteRecords captured correctly', JSON.stringify(exported.wasteRecords) === JSON.stringify([{id:'w1', qty:4}]), exported.wasteRecords);
  allPass &= check('billingRecheckCurrent captured correctly', JSON.stringify(exported.billingRecheckCurrent) === JSON.stringify({ marks: { 'x': {result:'found_paid'} } }), exported.billingRecheckCurrent);
  allPass &= check('activityLog captured correctly', JSON.stringify(exported.activityLog) === JSON.stringify([{id:'a1', action:'test'}]), exported.activityLog);
  allPass &= check('supplierShortfalls captured correctly', JSON.stringify(exported.supplierShortfalls) === JSON.stringify([{id:'s1', productId:'p1'}]), exported.supplierShortfalls);

  // ===== Test 2: importAllData() restores every root key back into storage =====
  const afterImport = await page.evaluate(async (payload) => {
    window.__store = {}; // simulate a totally empty/fresh backend before restoring
    const file = new File([JSON.stringify(payload)], 'backup.json', { type: 'application/json' });
    await importAllData(file);
    return JSON.parse(JSON.stringify(window.__store));
  }, exported);
  console.log('Store after import:', Object.keys(afterImport).sort());
  allPass &= check('rawLots restored into storage', JSON.stringify(afterImport.rawLots) === JSON.stringify([{id:'lot1', productId:'p7'}]), afterImport.rawLots);
  allPass &= check('wasteRecords restored into storage', JSON.stringify(afterImport.wasteRecords) === JSON.stringify([{id:'w1', qty:4}]), afterImport.wasteRecords);
  allPass &= check('lotProductBills restored into storage', JSON.stringify(afterImport.lotProductBills) === JSON.stringify([{id:'b1', billId:'bill1'}]), afterImport.lotProductBills);
  allPass &= check('lotTransportBills restored into storage', JSON.stringify(afterImport.lotTransportBills) === JSON.stringify([{id:'t1', billId:'bill1'}]), afterImport.lotTransportBills);
  allPass &= check('activityLog restored into storage', JSON.stringify(afterImport.activityLog) === JSON.stringify([{id:'a1', action:'test'}]), afterImport.activityLog);
  allPass &= check('billingRecheckCurrent restored into storage', JSON.stringify(afterImport.billingRecheckCurrent) === JSON.stringify({ marks: { 'x': {result:'found_paid'} } }), afterImport.billingRecheckCurrent);
  allPass &= check('billingRecheckHistory restored into storage', JSON.stringify(afterImport.billingRecheckHistory) === JSON.stringify([{startedAt:'2026-10-01T00:00:00Z'}]), afterImport.billingRecheckHistory);
  allPass &= check('supplierShortfalls restored into storage', JSON.stringify(afterImport.supplierShortfalls) === JSON.stringify([{id:'s1', productId:'p1'}]), afterImport.supplierShortfalls);
  allPass &= check('debts restored into storage', JSON.stringify(afterImport.debts) === JSON.stringify([{id:'d1', amount:100}]), afterImport.debts);
  allPass &= check('day data restored into storage', JSON.stringify(afterImport['day:2026-10-08']) === JSON.stringify(exported.days['day:2026-10-08']), 'day restored');

  // ===== Test 3: importing an OLD-style backup (missing the new extra keys) doesn't throw / doesn't wipe anything with nulls =====
  const oldStyleResult = await page.evaluate(async () => {
    window.__store = { rawLots: [{id:'preexisting'}] }; // something already there that an old backup shouldn't wipe
    const oldPayload = { exportedAt: '2026-01-01T00:00:00Z', settings: {branches:[]}, days: {}, debts: [] };
    const file = new File([JSON.stringify(oldPayload)], 'old-backup.json', { type: 'application/json' });
    let threw = false;
    try { await importAllData(file); } catch(e) { threw = true; }
    return { threw, rawLotsAfter: window.__store.rawLots };
  });
  console.log('Old-style backup import result:', JSON.stringify(oldStyleResult));
  allPass &= check('Importing an old-style backup (no extra keys) does not throw', !oldStyleResult.threw, oldStyleResult);
  allPass &= check('Importing an old-style backup does not wipe pre-existing rawLots with null', JSON.stringify(oldStyleResult.rawLotsAfter) === JSON.stringify([{id:'preexisting'}]), oldStyleResult.rawLotsAfter);

  console.log('\n=== SUMMARY ===');
  console.log(allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED');
  await browser.close();
  process.exit(allPass ? 0 : 1);
})();
