#!/usr/bin/env node
// เช็ค syntax ของทุก <script> ที่ไม่มี src ใน index.html ด้วย vm.Script
// ใช้: node tests/check-syntax.js [path/to/index.html]
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const file = process.argv[2] || path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(file, 'utf8');
const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
let m, count = 0, failed = 0;
while ((m = re.exec(html))) {
  const attrs = m[1] || '';
  if (/\ssrc\s*=/.test(attrs)) continue;
  const type = (attrs.match(/type\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
  if (type && !/javascript|module/i.test(type)) continue;
  count++;
  const line = html.slice(0, m.index).split('\n').length;
  try {
    if (type && /module/i.test(type)) {
      // module: เขียนเป็นไฟล์ .mjs ชั่วคราวแล้วให้ node --check ตรวจ
      const tmp = path.join(require('os').tmpdir(), `karmto-check-${process.pid}-${line}.mjs`);
      fs.writeFileSync(tmp, m[2]);
      try { require('child_process').execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }); }
      catch (err) { throw new Error(String(err.stderr || err.message).split('\n').slice(0, 5).join(' ')); }
      finally { fs.unlinkSync(tmp); }
      continue;
    }
    new vm.Script(m[2], { filename: `${path.basename(file)}:<script@${line}>` });
  } catch (e) {
    failed++;
    console.error(`FAIL <script> ที่บรรทัด ${line}: ${e.message}`);
  }
}
console.log(`${failed ? 'FAIL' : 'PASS'} ตรวจ inline script ${count} ก้อน, พัง ${failed}`);
process.exit(failed ? 1 : 0);
