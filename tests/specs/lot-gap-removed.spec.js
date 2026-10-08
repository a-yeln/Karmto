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

  const result = await page.evaluate(() => {
    // Reproduce the user's exact scenario: p7 (นางรม) is lot-tracked, has orders needing 65 units today,
    // but zero purchase entries recorded today (settled on a different day, as the deferred-settle design intends).
    const d = { orders: { c1: { p7: 65 } }, leftoverOut: {}, leftoverSince: {}, billingPaid: {}, billExtra: {}, billNote: {}, billClaimNotes: {}, expenses: [], personalIncome: [], personalExpense: [], purchases: [], purchaseGroupPayment: {}, messageOverrides: {} };
    const prevDay = { orders:{}, leftoverOut: {}, leftoverSince: {}, billingPaid: {}, billExtra: {}, billNote: {}, billClaimNotes: {}, expenses: [], personalIncome: [], personalExpense: [], purchases: [], purchaseGroupPayment: {}, messageOverrides: {} };
    const lotProductIds = new Set(['p7']);
    const gapsWithLot = computeDayGaps_('2026-09-17', d, prevDay, lotProductIds);

    // Regression: a NON-lot-tracked product (say p1) with the same missing-purchase scenario should still warn as before.
    const d2 = { orders: { c1: { p1: 20 } }, leftoverOut: {}, leftoverSince: {}, billingPaid: {}, billExtra: {}, billNote: {}, billClaimNotes: {}, expenses: [], personalIncome: [], personalExpense: [], purchases: [], purchaseGroupPayment: {}, messageOverrides: {} };
    const gapsNoLot = computeDayGaps_('2026-09-17', d2, prevDay, new Set());

    return {
      gapsWithLotTypes: gapsWithLot.map(g=>g.type),
      gapsWithLotTexts: gapsWithLot.map(g=>g.text),
      gapsNoLotTypes: gapsNoLot.map(g=>g.type),
      gapsNoLotTexts: gapsNoLot.map(g=>g.text),
    };
  });

  console.log('Result:', JSON.stringify(result, null, 2));
  allPass &= check('Lot-tracked product with orders but no same-day purchase entry: NO "purchase-lot" gap generated anymore', !result.gapsWithLotTypes.includes('purchase-lot'), result.gapsWithLotTypes);
  allPass &= check('Lot-tracked product: no "ขาด 65" text anywhere in the gaps for that day', !result.gapsWithLotTexts.some(t=>t.includes('ขาด 65')), result.gapsWithLotTexts);
  allPass &= check('Regression: NON-lot product with the same missing-purchase pattern STILL warns as before ("purchase" type)', result.gapsNoLotTypes.includes('purchase'), result.gapsNoLotTypes);
  allPass &= check('Regression: non-lot warning text mentions "ขาด 20"', result.gapsNoLotTexts.some(t=>t.includes('ขาด 20')), result.gapsNoLotTexts);

  console.log('\n=== SUMMARY ===');
  console.log(allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED');
  await browser.close();
  process.exit(allPass ? 0 : 1);
})();
