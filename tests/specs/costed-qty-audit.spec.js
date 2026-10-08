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

  let allPass = true;

  const result = await page.evaluate(async () => {
    // Scenario 1: draw with costedQty=59, but NO matching lotSettleAllocations anywhere in any day's purchases
    // (exactly the "write half-succeeded" incident: costedQty got bumped, purchase entry never made it).
    const lotOrphan = { id:'lotOrphan', productId:'p7', seller:'x', sellerNote:'', buyDate:'2026-09-16', qtyTotal:10, pricePerKg:160, extra:40, note:'', billId:'lotOrphan',
      draws:[ { id:'dOrphan', date:'2026-09-17', qtyUsed:5, sellableQty:71, totalCost:820, costedQty:59 } ] };

    // Scenario 2: a DIFFERENT draw, fully costed (30/30), WITH a matching purchase entry recorded on a LATER day
    // (deferred settle, exactly like the app's normal design) — must NOT be flagged.
    const lotOk = { id:'lotOk', productId:'p7', seller:'x', sellerNote:'', buyDate:'2026-09-15', qtyTotal:5, pricePerKg:160, extra:0, note:'', billId:'lotOk',
      draws:[ { id:'dOk', date:'2026-09-16', qtyUsed:2, sellableQty:30, totalCost:328, costedQty:30 } ] };

    rawLotsCache_ = [lotOrphan, lotOk];

    const blankDay = () => ({ orders: {}, leftoverOut: {}, leftoverSince: {}, billingPaid: {}, billExtra: {}, billNote: {}, billClaimNotes: {}, expenses: [], personalIncome: [], personalExpense: [], purchases: [], purchaseGroupPayment: {}, messageOverrides: {} });
    const day18 = blankDay();
    // The settle for dOk was recorded on 18/09 (a LATER day than the draw's own date 16/09) — deferred settle, by design.
    day18.purchases = [{ id:'purchOk1', productId:'p7', seller:'x', qty:2, price:160, extra:0, sellableQty:30, lotSettle:true, lotSettleAllocations:[{lotId:'lotOk', drawId:'dOk', qty:30, cost:328}] }];

    const dayMap = { '2026-09-18': day18 };
    // computeLotCostedQtyAudit_ needs a real dayMap (fed directly here to avoid a live network fetch in the test).
    const problems = await computeLotCostedQtyAudit_(rawLotsCache_, dayMap);
    return { problems };
  });

  console.log('Problems found:', JSON.stringify(result.problems, null, 2));
  allPass &= check('Orphaned draw (costedQty=59, zero matching purchase records anywhere) IS flagged', result.problems.some(p=>p.drawId==='dOrphan'), result.problems);
  const orphanProblem = result.problems.find(p=>p.drawId==='dOrphan');
  allPass &= check('Orphaned draw problem reports the correct missing amount (59)', orphanProblem && orphanProblem.missing===59, orphanProblem);
  allPass &= check('Deferred-settle draw (costedQty=30, matching allocation recorded on a LATER day) is NOT flagged', !result.problems.some(p=>p.drawId==='dOk'), result.problems);
  allPass &= check('Exactly one problem total (no false positive on the healthy draw)', result.problems.length===1, result.problems.length);

  console.log('\n=== SUMMARY ===');
  console.log(allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED');
  await browser.close();
  process.exit(allPass ? 0 : 1);
})();
