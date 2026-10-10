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
      async patchOps(key, ops, rootIsArray){
        let root = window.__store[key]; if(root===undefined) root = rootIsArray ? [] : {};
        root = JSON.parse(JSON.stringify(root));
        const opsArr = Array.isArray(ops) ? ops : [ops];
        for(const op of opsArr){
          if(op.deleteKey && op.path){
            let target = root; for(let i=0;i<op.path.length-1;i++){ const seg=op.path[i]; if(target[seg]===undefined) target[seg]={}; target=target[seg]; }
            delete target[op.path[op.path.length-1]];
          } else if(op.path){
            let target = root; for(let i=0;i<op.path.length-1;i++){ const seg=op.path[i]; if(target[seg]===undefined) target[seg]={}; target=target[seg]; }
            target[op.path[op.path.length-1]] = op.value;
          }
        }
        window.__store[key] = root;
        return {key, value: JSON.stringify(root), shared:false};
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

(async () => {
  const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
  const page = await browser.newPage({ viewport: { width: 420, height: 1400 } });
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  await page.goto((process.env.BASE_URL || 'http://localhost:8765') + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await stripBanner(page);
  await installMockStorage(page);

  let allPass = true;

  // สาขา 01, 02 เป็นสาขาปกติ, 13S เป็นสาขาที่ติ๊ก "แยกส่ง" ไว้แล้ว (มากับ DEFAULT_BRANCHES, separate:true)
  await page.evaluate(async () => {
    window.__store['day:2026-10-09'] = { orders: { '01': { p1: 5 }, '02': { p1: 3 }, '13S': { p1: 2 } }, leftoverOut:{}, leftoverSince:{}, billingPaid:{}, billExtra:{}, billNote:{}, billNoteShowOnBill:{}, billClaimNotes:{}, expenses:[], personalIncome:[], personalExpense:[], purchases:[], purchaseGroupPayment:{}, messageOverrides:{}, feeNote:'', dashNote:'' };
    currentDate = '2026-10-09'; dayData = window.__store['day:2026-10-09']; dayCache_['2026-10-09'] = dayData;
    await switchTab('order');
    await renderMessages();
  });
  await page.waitForTimeout(500);
  await stripBanner(page);

  // ===== Test 1: กลับไปเป็นก้อนข้อความแจ้งหนี้ก้อนเดียวเหมือนเดิม (ไม่แยกทีละสาขา) =====
  const debtBlocks = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.msgblock')).filter(el => el.querySelector('.tag.debt')).map(el => ({
      label: el.querySelector('.tag').childNodes[0].textContent.trim(),
      text: el.querySelector('.msgtext').textContent,
    }));
  });
  console.log('Debt blocks:', JSON.stringify(debtBlocks, null, 2));
  allPass &= check('Only ONE combined debt message block (reverted from per-branch split)', debtBlocks.length === 1, debtBlocks.length);
  const debtBlock = debtBlocks[0];
  allPass &= check('Debt block label is the plain original label (not per-branch)', debtBlock && debtBlock.label === 'ข้อความแจ้งหนี้', debtBlock && debtBlock.label);

  // ===== Test 2: ภายในก้อนเดียวกัน สาขาปกติ (01, 02) อยู่ก่อน แล้วค่อยมีหัวข้อ "แยกส่ง" ตามด้วยสาขาที่ติ๊กแยกส่งไว้ (13S) =====
  // ราคา p1 เริ่มต้น = 275/กก. (PRODUCTS[0].price) — orders สั่ง p1 5/3/2 กก. ตามลำดับ (01, 02, 13S) → 1375/825/550
  const text = debtBlock ? debtBlock.text : '';
  const idxNormal01 = text.indexOf('1 : ');
  const idxSeparateHeading = text.indexOf('แยกส่ง');
  const idx13S = text.indexOf('13S : ');
  allPass &= check('Normal branch 01 row is present', text.includes('1 : 1375'), text);
  allPass &= check('Normal branch 02 row is present', text.includes('2 : 825'), text);
  allPass &= check('"แยกส่ง" section heading is present', idxSeparateHeading !== -1, idxSeparateHeading);
  allPass &= check('Separate-flagged branch 13S row is present', text.includes('13S : 550'), text);
  allPass &= check('Normal rows come before the "แยกส่ง" heading, which comes before the separate row', idxNormal01 !== -1 && idxNormal01 < idxSeparateHeading && idxSeparateHeading < idx13S, {idxNormal01, idxSeparateHeading, idx13S});

  // ===== Test 3: "ORDER N สาขา" ต้องแยกนับสาขาปกติ+สาขาแยกส่ง ชัดเจน (2 ปกติ + 1 แยกส่ง -> "2+1") ทั้งในข้อความแจ้งหนี้
  // และหัวข้อสรุปยอดรวมทั้งหมด — ไม่เอาไปนับรวมกันเป็นก้อนเดียวเงียบๆ =====
  allPass &= check('Debt message "ORDER" header splits normal+separate as "2+1"', text.includes('ORDER 2+1 สาขา'), text);
  const summaryText = await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('.msgblock')).find(el => el.querySelector('.tag.all'));
    return el?.querySelector('.msgtext')?.textContent;
  });
  allPass &= check('Summary-total block "ORDER" header also splits normal+separate as "2+1"', summaryText && summaryText.includes('ORDER 2+1 สาขา'), summaryText);

  // ===== Test 3b: เฮดบาร์ (#statBarBranchChip) กับการ์ด "สาขาที่สั่ง" หน้าแดชบอร์ด ก็ต้องแยกนับ "2+1" เหมือนกัน =====
  const headerAndDashboard = await page.evaluate(async () => {
    await renderStats();
    await switchTab('dashboard');
    await renderDashboard();
    await switchTab('order');
    return {
      statBar: document.getElementById('statBarBranchChip')?.textContent,
      dashBranchesWide: document.getElementById('dashBranchesWide')?.textContent,
    };
  });
  console.log('Header bar + Dashboard tile:', JSON.stringify(headerAndDashboard));
  allPass &= check('Header bar "สาขา" chip splits normal+separate as "2+1"', headerAndDashboard.statBar === 'สาขา2+1', headerAndDashboard.statBar);
  allPass &= check('Dashboard "สาขาที่สั่ง" tile splits normal+separate as "2+1"', headerAndDashboard.dashBranchesWide === '2+1', headerAndDashboard.dashBranchesWide);

  // ===== Test 4: วันที่ไม่มีสาขาแยกส่งสั่งเลย -> ไม่โชว์หัวข้อ "แยกส่ง" และ "ORDER N" ไม่มี "+0" ต่อท้าย =====
  await page.evaluate(async () => {
    window.__store['day:2026-10-10'] = { orders: { '01': { p1: 5 }, '02': { p1: 3 } }, leftoverOut:{}, leftoverSince:{}, billingPaid:{}, billExtra:{}, billNote:{}, billNoteShowOnBill:{}, billClaimNotes:{}, expenses:[], personalIncome:[], personalExpense:[], purchases:[], purchaseGroupPayment:{}, messageOverrides:{}, feeNote:'', dashNote:'' };
    currentDate = '2026-10-10'; dayData = window.__store['day:2026-10-10']; dayCache_['2026-10-10'] = dayData;
    await renderMessages();
  });
  await page.waitForTimeout(400);
  await stripBanner(page);
  const noSeparateText = await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('.msgblock')).find(el => el.querySelector('.tag.debt'));
    return el?.querySelector('.msgtext')?.textContent;
  });
  console.log('No-separate-branch day debt text:', noSeparateText);
  allPass &= check('No "แยกส่ง" heading shown when no separate-flagged branch ordered today', noSeparateText && !noSeparateText.includes('แยกส่ง'), noSeparateText);
  allPass &= check('"ORDER N" header has no "+0" when there are no separate branches', noSeparateText && noSeparateText.includes('ORDER 2 สาขา') && !noSeparateText.includes('+0'), noSeparateText);

  // ===== Test 5: แก้ไขก้อนข้อความแจ้งหนี้ได้ตามปกติ (ก้อนเดียว ไม่ใช่ทีละสาขา) =====
  // การ์ด "ข้อความส่ง" ใหญ่พับไว้เป็นค่าเริ่มต้น (msgCardOpen=false) ต้องกางก่อนถึงจะ interact กับ textarea ข้างในได้จริง
  await page.click('#msgCardToggle');
  await page.waitForTimeout(200);
  const editDebug = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('[data-msgedit]')).find(b => b.closest('.msgblock').querySelector('.tag').classList.contains('debt'));
    const idx = btn.getAttribute('data-msgedit');
    btn.click();
    const wrap = document.getElementById(`msgeditwrap-${idx}`);
    return { idx, wrapDisplay: wrap ? wrap.style.display : 'MISSING' };
  });
  console.log('Edit click debug:', JSON.stringify(editDebug));
  await page.waitForTimeout(200);
  const editIdx = editDebug.idx;
  await page.fill(`#msgeditarea-${editIdx}`, 'ข้อความแจ้งหนี้ทดสอบ');
  await page.click(`[data-msgsave="${editIdx}"]`);
  await page.waitForTimeout(500);
  await stripBanner(page);

  const afterEdit = await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('.msgblock')).find(el => el.querySelector('.tag.debt'));
    return { text: el?.querySelector('.msgtext')?.textContent, edited: el?.querySelector('.tag')?.textContent.includes('แก้ไขแล้ว') };
  });
  console.log('After editing debt block:', JSON.stringify(afterEdit));
  allPass &= check('Debt block shows the edited text and is marked edited', afterEdit.text === 'ข้อความแจ้งหนี้ทดสอบ' && afterEdit.edited, afterEdit);

  console.log('\n=== SUMMARY ===');
  console.log(allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED');
  await browser.close();
  process.exit(allPass ? 0 : 1);
})();
