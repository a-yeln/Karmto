#!/usr/bin/env node
// รัน regression suite ทั้งหมดใน tests/specs/*.spec.js ทีละไฟล์ เป็น child process แยก (แต่ละไฟล์เปิด/ปิด browser ของตัวเอง
// สมบูรณ์ในตัว ไม่แชร์ state กัน) แล้วสรุปผลรวม — เริ่มเซิร์ฟ index.html ของ repo ผ่าน HTTP ให้เอง (ไฟล์ทดสอบเปิดผ่าน
// http://localhost:PORT เพราะเทสต้องพึ่งพฤติกรรม fetch/relative-path จริงของเบราว์เซอร์ เปิดเป็น file:// ตรงๆ ไม่ได้)
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const SPECS_DIR = path.join(__dirname, 'specs');
const REPO_ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.TEST_PORT || 8765);
const BASE_URL = `http://localhost:${PORT}`;

function findChromium() {
  if (process.env.PW_CHROMIUM_PATH) return process.env.PW_CHROMIUM_PATH;
  if (fs.existsSync('/opt/pw-browsers/chromium')) return '/opt/pw-browsers/chromium'; // ใช้ browser ที่ลงไว้แล้วในแซนด์บ็อกซ์นี้ ถ้ามี
  return null; // เครื่องอื่น: ปล่อยให้ Playwright ใช้ browser ของตัวเอง (ต้องรัน `npx playwright install chromium` ก่อนครั้งแรก)
}

async function waitForServer(url, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise(resolve => {
      http.get(url, res => { res.resume(); resolve(res.statusCode < 500); }).on('error', () => resolve(false));
    });
    if (ok) return true;
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}

function run(cmd, args, opts) {
  return new Promise(resolve => {
    const child = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', d => out += d);
    child.stderr.on('data', d => out += d);
    child.on('close', code => resolve({ code, out }));
  });
}

(async () => {
  const specs = fs.readdirSync(SPECS_DIR).filter(f => f.endsWith('.spec.js')).sort();
  if (specs.length === 0) {
    console.log('ไม่มีไฟล์ *.spec.js ใน tests/specs/ เลย');
    process.exit(1);
  }

  // เซิร์ฟ repo root เองถ้ายังไม่มีอะไรฟังอยู่ที่พอร์ตนี้ — กันซ้ำกับกรณีที่มีคน/สคริปต์อื่นเปิด server ไว้ก่อนแล้ว
  let server = null;
  const alreadyUp = await waitForServer(BASE_URL + '/index.html', 500);
  if (!alreadyUp) {
    server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: REPO_ROOT, stdio: 'ignore' });
    const up = await waitForServer(BASE_URL + '/index.html', 10000);
    if (!up) {
      console.log('เปิด HTTP server สำหรับ index.html ไม่สำเร็จ (พอร์ต ' + PORT + ')');
      server.kill();
      process.exit(1);
    }
  }

  const chromiumPath = findChromium();
  const env = { ...process.env, BASE_URL };
  if (chromiumPath) env.PW_CHROMIUM_PATH = chromiumPath;
  // แซนด์บ็อกซ์นี้ลง playwright ไว้แบบ global ที่ /opt/node22/lib/node_modules ไม่ได้อยู่ใน node_modules/ ของ repo — ต้องชี้
  // ผ่าน NODE_PATH ให้ require('playwright') เจอ (เครื่องอื่นที่ `npm install` ไว้ใน tests/ ตามปกติไม่ต้องใช้บรรทัดนี้)
  if (!process.env.NODE_PATH && !fs.existsSync(path.join(__dirname, 'node_modules', 'playwright')) && fs.existsSync('/opt/node22/lib/node_modules/playwright')) {
    env.NODE_PATH = '/opt/node22/lib/node_modules';
  }

  const results = [];
  for (const spec of specs) {
    process.stdout.write(`▶ ${spec} ... `);
    const { code, out } = await run('node', [path.join(SPECS_DIR, spec)], { env });
    const pass = code === 0;
    console.log(pass ? 'PASS' : 'FAIL');
    results.push({ spec, pass, out });
  }

  if (server) server.kill();

  console.log('\n=== สรุปผล ===');
  const failed = results.filter(r => !r.pass);
  results.forEach(r => console.log(`${r.pass ? '✅' : '❌'} ${r.spec}`));
  if (failed.length) {
    console.log(`\n${failed.length}/${results.length} ไฟล์ล้มเหลว — รายละเอียด:\n`);
    failed.forEach(r => {
      console.log(`----- ${r.spec} -----`);
      console.log(r.out);
    });
    process.exit(1);
  }
  console.log(`\nผ่านครบทั้งหมด ${results.length} ไฟล์`);
  process.exit(0);
})();
