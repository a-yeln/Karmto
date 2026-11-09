// ไล่เปิดทุกแท็บ ทุกธีม/โหมด บนจอมือถือ แล้วรายงานหน้าที่ "กว้างเกินจอ" (เลื่อนแนวนอนได้) พร้อมชื่อ element ที่ล้น
// รัน (ต้องเปิดเซิร์ฟเวอร์ที่ root ก่อน: python3 -m http.server 8765 &):
//   cd tests && NODE_PATH=/opt/node22/lib/node_modules PW_CHROMIUM_PATH=/opt/pw-browsers/chromium node ../.claude/skills/karmto-testing/scripts/mobile-overflow-sweep.js [width]
// ผลที่ต้องการ: NO OVERFLOW
const path = require('path');
const { launch, mkDay, openApp } = require(path.join(__dirname, '../../../../tests/helpers'));
const W = Number(process.argv[2] || 390);
(async () => {
  const b = await launch(); const T = '2026-11-07';
  const store = { rawLots: [{ id: 'L1', productId: 'p4', seller: 'ตลาดนัดใหญ่ชื่อยาวมาก', buyDate: '2026-11-01', qtyTotal: 10, pricePerKg: 200, billId: 'L1',
    draws: [{ id: 'D1', date: '2026-11-02', qtyUsed: 3, sellableQty: 3, costedQty: 1, totalCost: 600 }] }] };
  for (let d = 1; d <= 7; d++) {
    const iso = '2026-11-0' + d;
    store['day:' + iso] = mkDay({ orders: { '01': { p1: 5, p2: 2, p3: 8, p4: 1, p5: 1, p6: 1, p7: 10 }, '12': { p3: 13, p7: 17 }, '30': { p3: 10, p7: 40 } },
      purchases: [{ id: 'a' + d, productId: 'p1', qty: 5, price: 180, seller: 'มนต์' }, { id: 'b' + d, productId: 'p3', qty: 31, price: 200, seller: 'ม๊ะก๊าด' }],
      expenses: [{ id: 'e' + d, category: 'ค่าน้ำแข็ง', amount: 470 }], leftoverOut: { p2: 1 }, leftoverSince: { p2: iso } });
  }
  const tabs = ['dashboard', 'order', 'leftover', 'fee', 'purchase', 'stockform', 'billing', 'debts', 'personal', 'noti', 'settings'];
  const bad = [];
  for (const th of ['', 'mermaid', 'sea', 'neon']) for (const mode of ['full', 'color']) {
    if (!th && mode === 'color') continue;
    const p = await openApp(b, { store, date: T, viewport: { width: W, height: 844 } });
    await p.route(/fonts\./, r => r.abort());
    await p.clock.setFixedTime(new Date(T + 'T10:00:00+07:00'));
    for (const tab of tabs) {
      const r = await p.evaluate(async ([th, mode, tab]) => {
        if (th) { document.documentElement.setAttribute('data-theme', th); document.documentElement.setAttribute('data-tmode', mode); }
        try { await switchTab(tab); } catch (e) {}
        if (tab === 'dashboard') { try { document.getElementById('plMonthInput').value = '2026-11'; await renderMonthPL(); } catch (e) {} }
        await new Promise(r => setTimeout(r, 900));
        document.querySelectorAll('.card-body.collapsed').forEach(x => x.classList.remove('collapsed'));
        await new Promise(r => setTimeout(r, 150));
        const sw = document.documentElement.scrollWidth;
        const wide = sw > innerWidth + 1 ? [...document.querySelectorAll('.panel.active *')].filter(e => { const rc = e.getBoundingClientRect(); return rc.width > 0 && rc.right > innerWidth + 1 && !e.closest('.scrollx,[style*="overflow"]'); }).slice(-3).map(e => (e.id || String(e.className).slice(0, 30) || e.tagName)) : [];
        return { sw, wide };
      }, [th, mode, tab]);
      if (r.sw > W) bad.push(`${th || 'macaron'}/${mode} ${tab}: กว้าง ${r.sw}px  ${r.wide.join(' | ')}`);
    }
    await p.close();
  }
  console.log(bad.length ? bad.join('\n') : 'NO OVERFLOW');
  await b.close();
})();
