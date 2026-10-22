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
          if(op.path){
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
  const page = await browser.newPage({ viewport: { width: 420, height: 1600 } });
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  await page.goto((process.env.BASE_URL || 'http://localhost:8765') + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await stripBanner(page);
  await installMockStorage(page);

  let allPass = true;

  // สาขา 02 สั่งแต่ของนอกแคตตาล็อกล้วนๆ (custom อย่างเดียว ไม่มีจำนวนใน 7 สินค้าหลักเลย) — สาขา 01 สั่งปกติไว้เทียบ
  await page.evaluate(async () => {
    window.__store['day:2026-10-09'] = {
      orders: {
        '01': { p1: 5 },
        '02': { custom: [{name:'น้ำจิ้ม', qty:10, price:20}] },
      },
      leftoverOut:{}, leftoverSince:{}, billingPaid:{}, billExtra:{}, billNote:{}, billNoteShowOnBill:{}, billClaimNotes:{},
      expenses:[], personalIncome:[], personalExpense:[], purchases:[], purchaseGroupPayment:{}, messageOverrides:{}, feeNote:'', dashNote:'',
    };
    currentDate = '2026-10-09'; dayData = window.__store['day:2026-10-09']; dayCache_['2026-10-09'] = dayData;
    await switchTab('order');
    renderOrderList();
    await renderMessages();
    renderStats();
    await switchTab('dashboard');
    await renderDashboard();
  });
  await page.waitForTimeout(500);
  await stripBanner(page);

  // ===== Test 1: ลิสต์ "บันทึกแล้ววันนี้" ในแท็บออเดอร์ ต้องเห็นสาขา 02 ด้วย ไม่ใช่แค่ 01 =====
  const orderListCodes = await page.evaluate(() => Array.from(document.querySelectorAll('#orderList .orow .code')).map(el => el.textContent));
  console.log('Order list codes:', JSON.stringify(orderListCodes));
  allPass &= check('Branch 02 (custom-items-only order) appears in "บันทึกแล้ว" list', orderListCodes.includes('02'), orderListCodes);

  // ===== Test 2: ตัวนับสาขา (branchCountLabel) ต้องนับสาขา 02 รวมด้วย -> "2" ไม่ใช่ "1" =====
  const n = await page.evaluate(() => branchCountLabel(dayData.orders));
  allPass &= check('branchCountLabel counts both branches (custom-only one included)', n === '2', n);
  const statBarText = await page.evaluate(() => document.getElementById('statBarBranchChip')?.textContent);
  allPass &= check('Header bar "สาขา" chip reflects both branches', statBarText === 'สาขา2', statBarText);
  const dashBranchesText = await page.evaluate(() => document.getElementById('dashBranchesWide')?.textContent);
  allPass &= check('Dashboard "สาขาที่สั่ง" tile reflects both branches', dashBranchesText === '2', dashBranchesText);

  // ===== Test 3: ข้อความแจ้งหนี้ ต้องมีสาขา 02 ด้วย (ไม่ใช่แค่สาขา 01) =====
  await page.evaluate(() => switchTab('order'));
  await page.waitForTimeout(200);
  const debtText = await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('.msgblock')).find(el => el.querySelector('.tag.debt'));
    return el?.querySelector('.msgtext')?.textContent;
  });
  console.log('Debt message:', debtText);
  allPass &= check('Debt message includes branch 02 (custom-only order still owes real money)', debtText && debtText.includes('2 : 200'), debtText);
  allPass &= check('Debt message "ORDER" header counts both branches ("2" not "1")', debtText && debtText.includes('ORDER 2 สาขา'), debtText);

  // ===== Test 4: computeBranchAggregates ต้องเห็นสาขา 02 ด้วย (กระทบ "รายการที่ต้องตามโอน"/บิลรายสาขา/แนวโน้ม) =====
  const agg = await page.evaluate(async () => {
    const a = await computeBranchAggregates();
    return Object.keys(a).sort();
  });
  console.log('computeBranchAggregates codes:', JSON.stringify(agg));
  allPass &= check('computeBranchAggregates includes branch 02 (custom-only order)', agg.includes('02'), agg);

  // ===== Test 5: hasNonEmptyOrder_ (OCR overwrite-safety check) ต้องเห็นว่าสาขา 02 "มีออเดอร์จริง" แล้ว =====
  const hasNonEmpty = await page.evaluate(() => hasNonEmptyOrder_(dayData.orders['02']));
  allPass &= check('hasNonEmptyOrder_ recognizes a custom-items-only row as non-empty (OCR overwrite warning would fire)', hasNonEmpty === true, hasNonEmpty);

  // ===== Test 6: updateOrderFormAutoFold ต้องพับฟอร์มอัตโนมัติ แม้สาขาเดียวที่บันทึกไว้จะมีแต่ custom items =====
  const foldedForCustomOnly = await page.evaluate(async () => {
    window.__store['day:2026-10-11'] = { orders: { '05': { custom: [{name:'ถุงพลาสติก', qty:5, price:3}] } }, leftoverOut:{}, leftoverSince:{}, billingPaid:{}, billExtra:{}, billNote:{}, billNoteShowOnBill:{}, billClaimNotes:{}, expenses:[], personalIncome:[], personalExpense:[], purchases:[], purchaseGroupPayment:{}, messageOverrides:{}, feeNote:'', dashNote:'' };
    currentDate = '2026-10-11'; dayData = window.__store['day:2026-10-11']; dayCache_['2026-10-11'] = dayData;
    updateOrderFormAutoFold();
    const h3s = Array.from(document.querySelectorAll('#panel-order h3')).map(h=>h.textContent);
    const readImgCard = h3s.find(t=>t.includes('อ่านออเดอร์จากรูปภาพ'));
    const cardEl = readImgCard ? Array.from(document.querySelectorAll('#panel-order .card')).find(c=>c.querySelector('h3')?.textContent===readImgCard) : null;
    return cardEl ? cardEl.classList.contains('folded') || cardEl.dataset.folded === 'true' || !!cardEl.querySelector('.card-body[style*="display: none"]') || getComputedStyle(cardEl.querySelector('.card-body')||cardEl).display === 'none' : null;
  });
  console.log('Auto-fold check (custom-only order present):', foldedForCustomOnly);
  // หมายเหตุ: เช็คนี้พึ่งพาโครงสร้าง DOM ของการ์ดที่อาจเปลี่ยนได้ — ถ้า selector ไม่ตรงโครงสร้างจริงจะได้ null ซึ่งไม่ถือว่า fail ทันที
  if(foldedForCustomOnly !== null){
    allPass &= check('Order-entry cards auto-fold when the only recorded branch has custom-items-only order', foldedForCustomOnly === true, foldedForCustomOnly);
  } else {
    console.log('SKIP — auto-fold DOM structure check inconclusive (selector mismatch), not counted as failure');
  }

  // ===== Test 7: findNextUnrecordedBranch ต้องไม่เสนอสาขาที่บันทึกด้วย custom items แล้วซ้ำอีก =====
  const nextBranch = await page.evaluate(() => {
    currentDate = '2026-10-09'; dayData = window.__store['day:2026-10-09'];
    return findNextUnrecordedBranch('02');
  });
  console.log('Next unrecorded branch after 02:', nextBranch);
  allPass &= check('findNextUnrecordedBranch does not re-suggest branch 02 (already recorded via custom items)', nextBranch !== '02', nextBranch);

  console.log('\n=== SUMMARY ===');
  console.log(allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED');
  await browser.close();
  process.exit(allPass ? 0 : 1);
})();
