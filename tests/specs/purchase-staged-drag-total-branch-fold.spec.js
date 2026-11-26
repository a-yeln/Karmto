const { launch, mkDay, openApp, makeChecker } = require('../helpers');

// ผลรวมต่อแถวในรายการพักบิล + กดค้างลากสลับลำดับ + การ์ด "สาขาวันนี้" พับได้ + กากบาทปิดแจ้งเตือนไม่กลับมาเพราะตัวเลขเปลี่ยน
(async () => {
  const browser = await launch();
  const { check, finish } = makeChecker();
  const iso = '2026-10-20';
  const page = await openApp(browser, { store: { ['day:' + iso]: mkDay({ orders: { '01': { p1: 5, p2: 3 } } }) }, date: iso, viewport: { width: 420, height: 1000 } });
  await page.evaluate(async () => { localStorage.removeItem('karmto.purchAutoNext'); window.confirm = () => true; await switchTab('purchase'); });

  // 1) การ์ดสาขาวันนี้พับได้
  // แยกส่ง ชุด 2: การ์ด "สาขาวันนี้" พับ/กางด้วยกลไกของตัวเอง (แตะหัวการ์ด ไม่มีปุ่ม จำสถานะใน localStorage
  // karmto.branchGridFold) แทนตัวพับกลาง (.card-body/.collapsible) — ตรวจพฤติกรรมเดิม: เริ่มกาง, แตะหัวแล้วพับ, แตะอีกทีกาง
  const foldState = () => page.evaluate(() => {
    const head = document.getElementById('branchGridHead');
    const fold = document.getElementById('branchGridFold');
    return { hasHead: !!head, hasFold: !!fold, expanded: head ? head.getAttribute('aria-expanded') : null, closed: !!fold && fold.classList.contains('closed') };
  });
  await page.evaluate(async () => { await switchTab('order'); await new Promise(r => setTimeout(r, 400)); }); // การ์ดอยู่หน้าออเดอร์ — ตัวแตะหัวผูกตอนวาดการ์ด
  const fold = await foldState();
  check('Branch-grid card is collapsible and starts open', fold.hasHead && fold.hasFold && fold.expanded === 'true' && !fold.closed, fold);
  await page.evaluate(() => document.querySelector('#branchGridCard h3').click());
  const folded = await foldState();
  check('Clicking the header folds the branch grid', folded.expanded === 'false' && folded.closed, folded);
  await page.evaluate(() => document.querySelector('#branchGridCard h3').click());
  const reopened = await foldState();
  check('Clicking the header again opens the branch grid', reopened.expanded === 'true' && !reopened.closed, reopened);
  await page.evaluate(async () => { await switchTab('purchase'); });

  // 2) ผลรวมต่อท้ายทุกแถว
  const fill = (q, pr) => page.evaluate(([q, pr]) => { document.getElementById('purchQty').value = q; document.getElementById('purchPrice').value = pr; }, [q, pr]);
  await page.evaluate(() => { const s = document.getElementById('purchProduct'); s.value = 'p1'; s.onchange(); });
  await fill(7, 240); await page.evaluate(async () => { await addPurchToStage(); });
  await page.evaluate(() => { const s = document.getElementById('purchProduct'); s.value = 'p2'; s.onchange(); });
  await fill(14, 150); await page.evaluate(async () => { await addPurchToStage(); });
  const totals = await page.evaluate(() => [...document.querySelectorAll('.purch-staged-row .name')].map(n => n.textContent));
  check('Each staged row shows its line total', totals.length === 2 && totals[0].includes('1,680') && totals[1].includes('2,100'), totals);

  // 3) กดค้างแล้วลากสลับลำดับ
  const before = await page.evaluate(() => purchStagedRows.map(r => r.productId));
  await page.evaluate(() => document.querySelector('.purch-staged-row[data-purchstagrow="0"]').scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.waitForTimeout(250);
  const box = await page.evaluate(() => { const r = document.querySelector('.purch-staged-row[data-purchstagrow="0"]').getBoundingClientRect(); return { x: r.x + 20, y: r.y + r.height / 2 }; });
  const target = await page.evaluate(() => { const r = document.querySelector('.purch-staged-row[data-purchstagrow="1"]').getBoundingClientRect(); return { x: r.x + 20, y: r.y + r.height / 2 }; });
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.waitForTimeout(550);
  await page.mouse.move(target.x, target.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => purchStagedRows.map(r => r.productId));
  check('Long-press drag swaps staged row order', JSON.stringify(before) === '["p1","p2"]' && JSON.stringify(after) === '["p2","p1"]', { before, after });

  // 4) กากบาทปิดแจ้งเตือน: คีย์ไม่ขึ้นกับตัวเลขในข้อความ
  const keyStable = await page.evaluate(() => gapDismissKey_({ type: 'purchase-mismatch', text: 'กุ้งแช่ เกิน 1 กก. (ต้องการ 1 มี 2)' }) === gapDismissKey_({ type: 'purchase-mismatch', text: 'กุ้งแช่ เกิน 2 กก. (ต้องการ 1 มี 3)' }));
  check('Dismiss key ignores numbers in the alert text', keyStable);

  await page.screenshot({ path: 'screenshots/purchase-staged-drag-total-420.png', fullPage: false });
  await finish(browser);
})().catch(e => { console.error(e); process.exit(1); });
