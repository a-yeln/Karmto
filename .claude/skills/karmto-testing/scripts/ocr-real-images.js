// ให้แอปอ่านรูปออเดอร์จริงด้วยตัวอ่านในแอป (parseOrderImage) แล้วสรุปสาขา + รายการที่อ่านได้ — ใช้วัดผลก่อน/หลังแก้ตัวอ่านรูป
// ต้องต่อเน็ตได้ (โหลด tesseract + โมเดลภาษาไทยจาก CDN)
//   cd tests && NODE_PATH=/opt/node22/lib/node_modules PW_CHROMIUM_PATH=/opt/pw-browsers/chromium \
//     node ../.claude/skills/karmto-testing/scripts/ocr-real-images.js /path/a.jpg /path/b.jpg ...
const path = require('path'); const fs = require('fs');
const { launch, openApp } = require(path.join(__dirname, '../../../../tests/helpers'));
(async () => {
  const b = await launch();
  const p = await openApp(b, { store: {}, date: '2026-11-07', viewport: { width: 800, height: 800 } });
  for (const f of process.argv.slice(2)) {
    const b64 = fs.readFileSync(f).toString('base64');
    const r = await p.evaluate(async (b64) => {
      const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const file = new File([bin], 'x.jpg', { type: 'image/jpeg' });
      try { const t0 = Date.now(); const res = await parseOrderImage(file); return { ms: Date.now() - t0, res }; } catch (e) { return { err: e.message }; }
    }, b64);
    if (r.err) { console.log(path.basename(f), 'ERROR', r.err); continue; }
    const x = r.res;
    console.log(path.basename(f), `${r.ms}ms`, 'สาขา', x.branchCode, x.branchArea, '|',
      x.items.map(it => it.name.replace(/ {2,}.*/, '').slice(0, 20) + '=' + it.qty).join(', '), '| ไม่เจอจำนวน', x.unmatched.length);
  }
  await b.close();
})();
