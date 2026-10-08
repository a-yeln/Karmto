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
      async delete(key){ const existed = key in window.__store; delete window.__store[key]; return {key, deleted: existed, shared:false}; },
      async list(prefix){ return {keys: Object.keys(window.__store).filter(k=>k.startsWith(prefix||'')), prefix, shared:false}; },
      async patchField(key, path, value){ return {key, value: '{}', shared:false}; },
      async patchOps(key, ops, rootIsArray){ return {key, value: rootIsArray?'[]':'{}', shared:false}; },
    };
    window.bulkGetStorageImpl = async (keys) => { const out = {}; keys.forEach(k=>{ out[k] = window.__store[k]!==undefined ? JSON.stringify(window.__store[k]) : null; }); return out; };
  });
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
  await installMockStorage(page);
  await page.evaluate(() => switchTab('purchase'));
  await page.waitForTimeout(300);

  let allPass = true;

  const result = await page.evaluate(async () => {
    // Orphaned draw: costedQty=59, no matching purchase records ANYWHERE in storage.
    const lotOrphan = { id:'lotOrphan', productId:'p7', seller:'x', sellerNote:'', buyDate:'2026-09-16', qtyTotal:10, pricePerKg:160, extra:40, note:'', billId:'lotOrphan',
      draws:[ { id:'dOrphan', date:'2026-09-17', qtyUsed:5, sellableQty:71, totalCost:820, costedQty:59 } ] };
    rawLotsCache_ = [lotOrphan];
    window.__store['rawLots'] = [lotOrphan];

    const blankDay = () => ({ orders: {}, leftoverOut: {}, leftoverSince: {}, billingPaid: {}, billExtra: {}, billNote: {}, billClaimNotes: {}, expenses: [], personalIncome: [], personalExpense: [], purchases: [], purchaseGroupPayment: {}, messageOverrides: {} });
    window.__store['day:2026-09-17'] = blankDay();
    window.__store['day:2026-09-16'] = blankDay();

    // Set currentDate to a PAST date (2026-09-17), NOT today (todayISO() in this environment is 2026-09-23).
    currentDate = '2026-09-17';
    dayData = window.__store['day:2026-09-17'];
    dayCache_['2026-09-17'] = dayData;
    dayCache_['2026-09-16'] = window.__store['day:2026-09-16'];

    // Ensure the #purchaseGapsToday element exists (it's part of the purchase tab template already rendered by switchTab).
    await renderPurchaseGapsToday_();
    const htmlPastDate = document.getElementById('purchaseGapsToday').innerHTML;

    // Now check TODAY: staleness check should still only fire on today (regression), and costed-audit still fires too.
    currentDate = todayISO();
    dayCache_[todayISO()] = blankDay();
    dayData = dayCache_[todayISO()];
    await renderPurchaseGapsToday_();
    const htmlToday = document.getElementById('purchaseGapsToday').innerHTML;

    return { htmlPastDate, htmlToday, today: todayISO() };
  });

  console.log('Result today:', result.today);
  console.log('htmlPastDate:', result.htmlPastDate.replace(/\s+/g,' ').slice(0, 500));
  console.log('htmlToday:', result.htmlToday.replace(/\s+/g,' ').slice(0, 500));

  allPass &= check('Viewing a PAST date: costedQty-orphan warning NOW appears (the fix)', result.htmlPastDate.includes('เนื้อหอยนางรม') && result.htmlPastDate.includes('59'), null);
  allPass &= check('Viewing a PAST date: warning mentions the missing amount (59)', result.htmlPastDate.includes('ขาดไป 59'), null);
  allPass &= check('Viewing TODAY: costed-audit warning still appears too (regression)', result.htmlToday.includes('เนื้อหอยนางรม'), null);

  console.log('\n=== SUMMARY ===');
  console.log(allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED');
  await browser.close();
  process.exit(allPass ? 0 : 1);
})();
