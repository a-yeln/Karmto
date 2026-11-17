#!/usr/bin/env node
// ร่าง — ยังไม่เปิดใช้ (อยู่ใน .claude/gates/proposed/ ไม่มีใครเรียก)
//
// ตรวจว่า PR มีผล money-guard + security-guard ที่ "ผูกกับโค้ดชุดนี้จริง" ก่อน merge
// ใช้ได้ 2 แบบ (Node อย่างเดียว ไม่พึ่งแพ็กเกจนอก):
//   CI   : node check-gates.js [--base origin/main] [--head HEAD] [--branch ชื่อ]   → exit 0 ผ่าน / 1 บล็อก
//   hook : node check-gates.js --hook  (อ่าน JSON ของ PreToolUse ทาง stdin)        → exit 0 ปล่อย / 2 บล็อก
//   ช่วยเติมไฟล์ผล: node check-gates.js --fingerprint                             → พิมพ์ลายนิ้วมือของโค้ดตอนนี้
//
// ลายนิ้วมือ = sha256 ของ `git diff <merge-base>..HEAD` โดยไม่นับโฟลเดอร์ .claude/gates/results/
//   - เพิ่ม/แก้ไฟล์ผลด่าน → ลายนิ้วมือไม่เปลี่ยน (แก้ปัญหาไก่กับไข่ของ SHA)
//   - แก้โค้ดใดๆ หลังตรวจ (รวมแก้ตัวตรวจนี้เอง) → ลายนิ้วมือเปลี่ยน = ต้องตรวจซ้ำ
'use strict';
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const path = require('path');

const RESULTS_DIR = '.claude/gates/results';
// ไฟล์ที่ "แตะเงิน/ความปลอดภัย" — แตะเมื่อไหร่ guard ต้อง "ผ่าน" เท่านั้น (ห้าม "ไม่เกี่ยว")
const SENSITIVE = [/^index\.html$/, /^backend\//];
const REQUIRED = ['money-guard', 'security-guard'];
// แถวอื่นจาก TEMPLATE.md — ขาด/ไม่ตรง = คำเตือน ไม่บล็อก
const ADVISORY = [
  { key: 'เทส', label: 'เทสครบทุก spec' },
  { key: 'ui-checker', label: 'ui-checker' },
  { key: 'perf-guard', label: 'perf-guard' },
  { key: 'release', label: 'release' },
  { key: 'plan-reviewer', label: 'plan-reviewer' },
  { key: 'ผู้จัดการ', label: 'ผู้จัดการตัดสิน' },
];
const MIN_FP = 12;

function git(args, opts = {}) {
  return execFileSync('git', args, {
    cwd: opts.cwd, encoding: opts.buffer ? null : 'utf8', maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function parseArgs(argv) {
  const a = { base: 'origin/main', head: 'HEAD', branch: null, hook: false, fingerprint: false, cwd: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--hook') a.hook = true;
    else if (k === '--fingerprint') a.fingerprint = true;
    else if (k === '--base') a.base = argv[++i];
    else if (k === '--head') a.head = argv[++i];
    else if (k === '--branch') a.branch = argv[++i];
    else if (k === '--cwd') a.cwd = argv[++i];
  }
  return a;
}

// ---------- ลายนิ้วมือ ----------
// ตั้งค่า diff ให้เหมือนกันทุกเครื่อง (ไม่ขึ้นกับ config ส่วนตัว เช่น diff.noprefix / diff.renames / สี)
const DIFF_FLAGS = ['-c', 'core.quotepath=false', '-c', 'diff.mnemonicPrefix=false', '-c', 'diff.noprefix=false'];
const DIFF_OPTS = ['--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', '--binary', '--full-index',
  '--src-prefix=a/', '--dst-prefix=b/'];
const EXCLUDE = ['--', '.', `:(exclude)${RESULTS_DIR}`];

function mergeBase(ctx) { return git(['merge-base', ctx.base, ctx.head], ctx).trim(); }

function fingerprint(ctx, mb) {
  const out = git([...DIFF_FLAGS, 'diff', ...DIFF_OPTS, mb, ctx.head, ...EXCLUDE], { ...ctx, buffer: true });
  return crypto.createHash('sha256').update(out).digest('hex');
}

function changedCodeFiles(ctx, mb) {
  return git(['-c', 'core.quotepath=false', 'diff', '--name-only', '--no-renames', mb, ctx.head, ...EXCLUDE], ctx)
    .split('\n').map(s => s.trim()).filter(Boolean);
}

function changedResultFiles(ctx, mb) {
  return git(['-c', 'core.quotepath=false', 'diff', '--name-status', '--no-renames', mb, ctx.head, '--', RESULTS_DIR], ctx)
    .split('\n').map(s => s.trim()).filter(Boolean)
    .map(l => l.split('\t')).filter(([st, f]) => st !== 'D' && /\.md$/.test(f)).map(([, f]) => f);
}

// ---------- อ่านไฟล์ผล ----------
function normResult(s) {
  const t = String(s || '').replace(/[*_`~]/g, '').replace(/[✅❌⚠️✔✖]/g, '').trim();
  if (t === 'ผ่าน') return 'ผ่าน';
  if (t === 'ไม่ผ่าน') return 'ไม่ผ่าน';
  if (t === 'ไม่เกี่ยว') return 'ไม่เกี่ยว';
  return t === '' ? '' : 'อื่นๆ:' + t;
}
function normFp(s) { return String(s || '').replace(/[`*\s]/g, '').toLowerCase(); }

function parseRows(text) {
  const rows = [];
  let header = null;
  for (const line of String(text).split(/\r?\n/)) {
    const l = line.trim();
    if (!l.startsWith('|')) continue;
    const cells = l.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
    if (cells.every(c => /^:?-{2,}:?$/.test(c) || c === '')) continue; // แถวเส้นคั่น
    if (!header && /ด่าน/.test(cells[0]) && /ผล/.test(cells[1] || '')) { header = cells; continue; }
    if (!header) continue;
    rows.push({ name: cells[0] || '', result: normResult(cells[1]), rawResult: cells[1] || '', fp: normFp(cells[2]), reason: (cells[3] || '').trim() });
  }
  return rows;
}

function rowsFor(rows, key) { return rows.filter(r => r.name.toLowerCase().includes(key.toLowerCase())); }
function fpMatches(rowFp, fullFp) { return /^[0-9a-f]+$/.test(rowFp) && rowFp.length >= MIN_FP && fullFp.startsWith(rowFp); }
function sameFp(a, b) { return a && b && a.length >= MIN_FP && b.length >= MIN_FP && (a.startsWith(b) || b.startsWith(a)); }

// ---------- ตรวจ ----------
function check(ctx) {
  const errors = [], warnings = [];
  const mb = mergeBase(ctx);
  const fp = fingerprint(ctx, mb);
  const files = changedCodeFiles(ctx, mb);
  const sensitive = files.filter(f => SENSITIVE.some(re => re.test(f)));

  const results = changedResultFiles(ctx, mb);
  let resultFile = null;
  if (results.length === 1) resultFile = results[0];
  else if (results.length > 1) {
    const want = (ctx.branch || '').replace(/[^A-Za-z0-9._-]+/g, '-') + '.md';
    resultFile = results.find(f => path.basename(f) === want) || null;
    if (!resultFile) errors.push(`PR นี้มีไฟล์ผลด่านมากกว่า 1 ไฟล์ (${results.join(', ')}) — ให้เหลือไฟล์เดียว หรือตั้งชื่อตาม branch: ${RESULTS_DIR}/${want}`);
  } else {
    errors.push(`ไม่มีไฟล์ผลด่านใน PR นี้ — ต้อง commit ไฟล์ ${RESULTS_DIR}/<ชื่อ branch>.md ที่มีแถว money-guard และ security-guard`);
  }

  if (resultFile) {
    const text = git(['show', `${ctx.head}:${resultFile}`], ctx);
    const rows = parseRows(text);
    if (!rows.length) errors.push(`อ่านตารางใน ${resultFile} ไม่ได้ — ต้องมีหัวตาราง | ด่าน | ผล | ลายนิ้วมือที่ตรวจ | เหตุผล/หมายเหตุ |`);

    // ประวัติของไฟล์ผลใน PR นี้: guard เคย "ไม่ผ่าน" ที่ลายนิ้วมือไหนบ้าง
    const failedBefore = { 'money-guard': [], 'security-guard': [] };
    const commits = git(['log', '--format=%H', `${mb}..${ctx.head}`, '--', resultFile], ctx).split('\n').filter(Boolean);
    for (const c of commits) {
      let old;
      try { old = git(['show', `${c}:${resultFile}`], ctx); } catch (e) { continue; }
      for (const g of REQUIRED) for (const r of rowsFor(parseRows(old), g)) if (r.result === 'ไม่ผ่าน' && r.fp) failedBefore[g].push(r.fp);
    }

    for (const g of REQUIRED) {
      const rs = rowsFor(rows, g);
      if (rs.length === 0) { errors.push(`ขาดแถว ${g} — ยังไม่ได้ตรวจ = ห้าม merge`); continue; }
      if (rs.length > 1) {
        const kinds = [...new Set(rs.map(r => r.result))];
        errors.push(kinds.length > 1
          ? `แถว ${g} มี ${rs.length} แถวและผลขัดกัน (${kinds.join(' / ')}) — ให้เหลือแถวเดียว`
          : `แถว ${g} ซ้ำ ${rs.length} แถว — ให้เหลือแถวเดียว`);
        continue;
      }
      const r = rs[0];
      if (r.result === '') { errors.push(`แถว ${g} ยังว่าง (ไม่มีผล) — ยังไม่ได้ตรวจ = ห้าม merge`); continue; }
      if (r.result.startsWith('อื่นๆ:')) { errors.push(`แถว ${g} เขียนผลว่า "${r.rawResult}" — ต้องเป็น ผ่าน / ไม่ผ่าน / ไม่เกี่ยว เท่านั้น`); continue; }
      if (r.result === 'ไม่ผ่าน') { errors.push(`${g} ตัดสิน "ไม่ผ่าน" — ห้าม merge (ต้องแก้โค้ดแล้วให้ ${g} ตรวจใหม่)`); continue; }
      if (!fpMatches(r.fp, fp)) {
        errors.push(r.fp
          ? `${g} ตรวจโค้ดชุดเก่า (ลายนิ้วมือ ${r.fp.slice(0, 12)}…) แต่โค้ดตอนนี้คือ ${fp.slice(0, 12)}… — มีการแก้หลังตรวจ ต้องให้ ${g} ตรวจซ้ำ`
          : `แถว ${g} ไม่มีลายนิ้วมือ (อย่างน้อย ${MIN_FP} ตัวอักษร) — รัน node check-gates.js --fingerprint แล้วให้ ${g} ใส่`);
        continue;
      }
      if (r.result === 'ผ่าน' && failedBefore[g].some(f => sameFp(f, r.fp))) {
        errors.push(`${g} เคยตัดสิน "ไม่ผ่าน" กับโค้ดชุดนี้ (ลายนิ้วมือเดิม) แล้วถูกเปลี่ยนเป็น "ผ่าน" โดยไม่ได้แก้โค้ด — กลับคำไม่ได้ ต้องแก้โค้ดแล้วตรวจใหม่`);
        continue;
      }
      if (r.result === 'ไม่เกี่ยว') {
        if (!r.reason || r.reason.length < 4) errors.push(`${g} ใส่ "ไม่เกี่ยว" แต่ไม่มีเหตุผล — ต้องเขียนเหตุผลในช่อง เหตุผล/หมายเหตุ`);
        if (sensitive.length) errors.push(`${g} ใส่ "ไม่เกี่ยว" แต่ PR นี้แก้ ${sensitive.join(', ')} จริง — ไฟล์พวกนี้ต้องให้ ${g} ตรวจและ "ผ่าน" เท่านั้น`);
      }
    }

    for (const a of ADVISORY) {
      const rs = rowsFor(rows, a.key);
      if (!rs.length) { warnings.push(`ไม่มีแถว ${a.label}`); continue; }
      const r = rs[0];
      if (r.result === '') warnings.push(`แถว ${a.label} ยังว่าง`);
      else if (r.result === 'ไม่ผ่าน') warnings.push(`แถว ${a.label} = ไม่ผ่าน`);
      else if (r.result !== 'ไม่เกี่ยว' && r.fp && !fpMatches(r.fp, fp)) warnings.push(`แถว ${a.label} ตรวจโค้ดชุดเก่า (ลายนิ้วมือไม่ตรง)`);
    }
  }
  return { fp, files, sensitive, resultFile, errors, warnings };
}

function report(res, mode) {
  const lines = [];
  if (res.errors.length) {
    lines.push('⛔ บล็อก merge: ด่านเงิน/ความปลอดภัยยังไม่ครบ');
    res.errors.forEach(e => lines.push('  - ' + e));
  } else {
    lines.push('✅ ด่าน money-guard + security-guard ครบและตรงกับโค้ดชุดนี้');
  }
  if (res.warnings.length) {
    lines.push('คำเตือน (ไม่บล็อก):');
    res.warnings.forEach(w => lines.push('  - ' + w));
  }
  lines.push(`ลายนิ้วมือโค้ดตอนนี้: ${res.fp}`);
  lines.push(`ไฟล์ผลด่าน: ${res.resultFile || '(ไม่พบ)'} • ไฟล์โค้ดที่เปลี่ยน ${res.files.length} ไฟล์` +
    (res.sensitive.length ? ` (แตะไฟล์เงิน/ระบบ: ${res.sensitive.join(', ')})` : ' (ไม่แตะ index.html/backend)'));
  return lines.join('\n');
}

// ---------- hook ----------
function isMergeAttempt(input) {
  const tool = String(input.tool_name || '');
  const ti = input.tool_input || {};
  if (tool === 'Bash') {
    const cmd = String(ti.command || '');
    return /\bgh\s+pr\s+merge\b/.test(cmd) || /\bgh\s+api\b[^\n]*\/pulls\/\d+\/merge\b/.test(cmd);
  }
  return /merge_pull_request|enable_pr_auto_merge/.test(tool);
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  let input = null;
  if (a.hook) {
    let raw = '';
    try { raw = require('fs').readFileSync(0, 'utf8'); } catch (e) { /* ไม่มี stdin */ }
    try { input = JSON.parse(raw || '{}'); } catch (e) { input = {}; }
    if (!isMergeAttempt(input)) process.exit(0);
  }
  const fail = a.hook ? 2 : 1;
  let cwd = a.cwd || (a.hook && process.env.CLAUDE_PROJECT_DIR) || null;
  try { cwd = git(['rev-parse', '--show-toplevel'], { cwd }).trim(); }
  catch (e) { console.error('⛔ บล็อก: หา git repo ไม่เจอ ตรวจด่านไม่ได้'); process.exit(fail); }
  let branch = a.branch || process.env.GITHUB_HEAD_REF || '';
  if (!branch) { try { branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd }).trim(); } catch (e) { /* ปล่อยว่าง */ } }
  const ctx = { cwd, base: a.base, head: a.head, branch };

  if (a.fingerprint) {
    try { console.log(fingerprint(ctx, mergeBase(ctx))); process.exit(0); }
    catch (e) { console.error('คำนวณลายนิ้วมือไม่ได้: ' + (e.stderr || e.message)); process.exit(1); }
  }

  let res;
  try { res = check(ctx); }
  catch (e) {
    // ตรวจไม่ได้ = ปิดประตูไว้ก่อน (fail closed)
    console.error(`⛔ บล็อก merge: ตรวจด่านไม่สำเร็จ (${String(e.stderr || e.message).trim().split('\n')[0]}) — ถ้า ${a.base} ไม่มีในเครื่อง ให้ git fetch origin main ก่อน`);
    process.exit(fail);
  }
  if (a.hook) {
    if (branch === 'main' || branch === 'HEAD') res.errors.unshift(`ตอนนี้เครื่องอยู่ที่ ${branch} ไม่ใช่ branch ของ PR — สลับไป branch ของ PR ก่อน merge`);
    res.warnings.push('hook ตรวจ branch ที่เปิดอยู่ในเครื่อง (' + branch + ') — ถ้ากำลัง merge PR ของ branch อื่น ผลนี้ไม่ใช่ของ PR นั้น');
  }
  const msg = report(res, a.hook ? 'hook' : 'ci');
  if (res.errors.length) { console.error(msg); process.exit(fail); }
  console.log(msg);
  process.exit(0);
}

if (require.main === module) main();
module.exports = { parseRows, normResult, isMergeAttempt };
