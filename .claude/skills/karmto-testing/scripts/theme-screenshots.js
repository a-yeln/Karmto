// แคปหน้าจอแท็บที่ระบุ ทุกธีม (full) ที่ความกว้างมือถือ เก็บเป็น PNG ไว้ดูด้วยตาก่อนส่งงาน
//   cd tests && NODE_PATH=/opt/node22/lib/node_modules PW_CHROMIUM_PATH=/opt/pw-browsers/chromium \
//     node ../.claude/skills/karmto-testing/scripts/theme-screenshots.js <tab> <outDir> [cssSelectorToScrollTo] [width]
// ภาพที่ AY จะดู ใช้ deviceScaleFactor 2; ภาพที่ดูเองตรวจงาน 1 ก็พอ
const path = require('path');
const { launch, mkDay, openApp } = require(path.join(__dirname, '../../../../tests/helpers'));
const [tab = 'dashboard', out = '.', sel = '', w = '420'] = process.argv.slice(2);
(async () => {
  const b = await launch(); const T = '2026-11-07';
  const store = { rawLots: [], ['day:' + T]: mkDay({ orders: { '01': { p1: 5, p7: 10 } } }) };
  for (const th of ['', 'mermaid', 'sea', 'neon']) {
    const p = await openApp(b, { store, date: T, viewport: { width: Number(w), height: 844 } });
    await p.route(/fonts\./, r => r.abort());
    await p.clock.setFixedTime(new Date(T + 'T10:00:00+07:00'));
    await p.evaluate(async ([th, tab, sel]) => {
      if (th) { document.documentElement.setAttribute('data-theme', th); document.documentElement.setAttribute('data-tmode', 'full'); }
      await switchTab(tab); await new Promise(r => setTimeout(r, 800));
      if (sel) { const el = document.querySelector(sel); if (el) el.scrollIntoView(); window.scrollBy(0, -120); }
    }, [th, tab, sel]);
    await p.waitForTimeout(300);
    await p.screenshot({ path: path.join(out, `${tab}-${th || 'macaron'}.png`) });
    await p.close();
  }
  await b.close(); console.log('saved to', out);
})();
