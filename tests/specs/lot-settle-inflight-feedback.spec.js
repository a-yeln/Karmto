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
  await page.evaluate(() => switchTab('purchase'));
  await page.waitForTimeout(300);

  let allPass = true;

  const result = await page.evaluate(async () => {
    let toastMsgs = [];
    const origToast = window.showToast;
    window.showToast = (msg) => { toastMsgs.push(msg); return origToast ? origToast(msg) : undefined; };

    // Simulate "something else is already settling" by manually setting the shared flag,
    // exactly the real-world collision: auto-settle loop still mid-flight when a click lands.
    lotSettleInFlight_ = true;
    const manualResult = await confirmLotSettle_('p7'); // manual call (no opts.auto)
    const toastCountAfterManual = toastMsgs.length;
    const autoResult = await confirmLotSettle_('p7', {auto:true}); // auto call, should stay silent
    const toastCountAfterAuto = toastMsgs.length;
    const backfillNoOp = await backfillLotCostGap_('someLotId', 'someDrawId');
    lotSettleInFlight_ = false;

    return { toastMsgs, manualResult, autoResult, backfillNoOp, autoAddedNoToast: toastCountAfterAuto===toastCountAfterManual };
  });

  console.log('Result:', JSON.stringify(result, null, 2));
  allPass &= check('Manual settle click while blocked shows a visible toast (not silent)', result.toastMsgs.some(m=>m && m.includes('กำลังตัดต้นทุนอยู่')), result.toastMsgs);
  allPass &= check('Auto settle call while blocked stays silent (no extra toast noise)', result.autoAddedNoToast === true, result.autoAddedNoToast);
  allPass &= check('Backfill click while blocked shows a visible toast (not silent) — this was the reported bug', result.toastMsgs.some(m=>m && m.includes('กำลังบันทึกรายการอื่นอยู่')), result.toastMsgs);
  allPass &= check('Manual settle returns {ok:false} when blocked', result.manualResult && result.manualResult.ok===false, result.manualResult);

  console.log('\n=== SUMMARY ===');
  console.log(allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED');
  await browser.close();
  process.exit(allPass ? 0 : 1);
})();
