#!/usr/bin/env node
// ตรวจว่าสกิลของทีม agent Karmto ยังตรงกับของจริง (อ่านอย่างเดียว ไม่แก้ไฟล์ใดๆ)
// ใช้: node tools/check-skills.js   → ERROR อย่างน้อย 1 ข้อ = exit 1, มีแค่ WARN = exit 0
//  (ก) skills: ใน .claude/agents/karmto-*.md ต้องมีไฟล์ .claude/skills/<x>/SKILL.md
//  (ข) ตาราง "เจ้าของสกิล" และ "สกิลที่แต่ละ agent ต้องมี" ใน .claude/agents/ORG.md ต้องตรงกับ frontmatter
//  (ค) ชื่อฟังก์ชัน + เลขบรรทัดใน karmto-codebase-map ต้องมีจริงใน index.html (เลื่อนเกิน 30 บรรทัด = WARN)
//  (ง) BACKUP_EXTRA_ROOT_KEYS ใน index.html กับ backend/BackupTrigger.gs ต้องเป็นชุดเดียวกัน
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const AGENTS = path.join(ROOT, '.claude', 'agents');
const SKILLS = path.join(ROOT, '.claude', 'skills');
const LINE_TOLERANCE = 30;

const errors = [];
const warns = [];
const err = (m) => errors.push(m);
const warn = (m) => warns.push(m);
const read = (p) => fs.readFileSync(p, 'utf8');
const rel = (p) => path.relative(ROOT, p);

// ---------- (ก) frontmatter skills ----------
function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return null;
  const lines = m[1].split(/\r?\n/);
  const out = { name: null, skills: [] };
  for (let i = 0; i < lines.length; i++) {
    const nm = /^name:\s*(.+)$/.exec(lines[i]);
    if (nm) out.name = nm[1].trim();
    if (/^skills:\s*$/.test(lines[i])) {
      for (let j = i + 1; j < lines.length && /^\s+-\s+/.test(lines[j]); j++) {
        out.skills.push(lines[j].replace(/^\s+-\s+/, '').trim());
      }
    }
  }
  return out;
}

const agentFiles = fs.readdirSync(AGENTS).filter((f) => /^karmto-.*\.md$/.test(f)).sort();
const agents = {}; // name -> Set(skills)
for (const f of agentFiles) {
  const p = path.join(AGENTS, f);
  const fm = parseFrontmatter(read(p));
  if (!fm) { err(`(ก) ${rel(p)}: ไม่พบ frontmatter`); continue; }
  const name = fm.name || f.replace(/\.md$/, '');
  if (fm.name && fm.name !== f.replace(/\.md$/, '')) warn(`(ก) ${rel(p)}: name "${fm.name}" ไม่ตรงชื่อไฟล์`);
  agents[name] = new Set(fm.skills);
  for (const s of fm.skills) {
    if (!fs.existsSync(path.join(SKILLS, s, 'SKILL.md'))) err(`(ก) ${name}: สกิล "${s}" ไม่มีไฟล์ .claude/skills/${s}/SKILL.md`);
  }
}
const allSkills = fs.existsSync(SKILLS)
  ? fs.readdirSync(SKILLS).filter((d) => fs.existsSync(path.join(SKILLS, d, 'SKILL.md'))).sort()
  : [];

// ---------- (ข) ORG.md tables ----------
function tableAfterHeading(text, headingRe) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^#{1,6}\s/.test(l) && headingRe.test(l));
  if (start < 0) return null;
  const rows = [];
  let inTable = false;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^#{1,6}\s/.test(l)) break;
    if (/^\s*\|/.test(l)) {
      inTable = true;
      const cells = l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue; // เส้นคั่นหัวตาราง
      rows.push(cells);
    } else if (inTable) break;
  }
  return rows.slice(1); // ตัดหัวตาราง
}
const ticks = (cell) => (cell.match(/`([^`]+)`/g) || []).map((x) => x.slice(1, -1).trim());
const bare = (cell) => cell.replace(/`/g, '').trim();

const orgPath = path.join(AGENTS, 'ORG.md');
if (!fs.existsSync(orgPath)) {
  err('(ข) ไม่พบ .claude/agents/ORG.md');
} else {
  const org = read(orgPath);
  const owners = tableAfterHeading(org, /เจ้าของสกิล/);
  const need = tableAfterHeading(org, /สกิลที่แต่ละ agent ต้องมี/);
  if (!owners) err('(ข) ORG.md: ไม่พบตารางใต้หัวข้อ "เจ้าของสกิล"');
  if (!need) err('(ข) ORG.md: ไม่พบตารางใต้หัวข้อ "สกิลที่แต่ละ agent ต้องมี"');

  if (owners) {
    const owned = new Map();
    for (const [ownerCell, skillCell] of owners) {
      const owner = bare(ownerCell || '');
      if (!agents[owner]) err(`(ข) ORG.md เจ้าของสกิล: "${owner}" ไม่มีไฟล์ agent`);
      for (const s of ticks(skillCell || '')) {
        if (owned.has(s)) err(`(ข) ORG.md: สกิล "${s}" มีเจ้าของสองคน (${owned.get(s)}, ${owner})`);
        owned.set(s, owner);
        if (!allSkills.includes(s)) err(`(ข) ORG.md เจ้าของสกิล: "${s}" ไม่มีไฟล์สกิล`);
      }
    }
    for (const s of allSkills) if (!owned.has(s)) warn(`(ข) สกิล "${s}" ยังไม่มีเจ้าของในตาราง ORG.md`);
  }

  if (need) {
    const listed = new Set();
    for (const [agentCell, skillCell] of need) {
      const a = bare(agentCell || '');
      listed.add(a);
      const want = new Set(ticks(skillCell || ''));
      if (!agents[a]) { err(`(ข) ORG.md ตารางสกิล: "${a}" ไม่มีไฟล์ agent`); continue; }
      const have = agents[a];
      const missing = [...want].filter((s) => !have.has(s));
      const extra = [...have].filter((s) => !want.has(s));
      if (missing.length) err(`(ข) ${a}: ORG.md บอกว่าต้องมี แต่ frontmatter ไม่มี → ${missing.join(', ')}`);
      if (extra.length) err(`(ข) ${a}: frontmatter มี แต่ ORG.md ไม่ได้ระบุ → ${extra.join(', ')}`);
    }
    for (const a of Object.keys(agents)) if (!listed.has(a)) err(`(ข) agent "${a}" ไม่อยู่ในตาราง "สกิลที่แต่ละ agent ต้องมี" ของ ORG.md`);
  }
}

// ---------- (ค) codebase-map vs index.html ----------
const indexPath = path.join(ROOT, 'index.html');
const mapPath = path.join(SKILLS, 'karmto-codebase-map', 'SKILL.md');
let mapChecked = 0;
if (!fs.existsSync(indexPath)) err('(ค) ไม่พบ index.html');
else if (!fs.existsSync(mapPath)) err('(ค) ไม่พบ .claude/skills/karmto-codebase-map/SKILL.md');
else {
  const idxLines = read(indexPath).split(/\r?\n/);
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const defCache = new Map();
  function findDef(name) {
    if (defCache.has(name)) return defCache.get(name);
    const n = esc(name);
    const re = new RegExp(
      `(?:\\bfunction\\s*\\*?\\s*${n}\\s*\\()|(?:\\b(?:const|let|var)\\s+${n}\\b)|(?:(?:^|[\\s,{.])${n}\\s*[:=]\\s*(?:async\\s+)?(?:function\\b|\\([^)]*\\)\\s*=>|[A-Za-z_$][\\w$]*\\s*=>))`
    );
    const found = [];
    idxLines.forEach((l, i) => { if (re.test(l)) found.push(i + 1); });
    defCache.set(name, found);
    return found;
  }

  const mapLines = read(mapPath).split(/\r?\n/);
  mapLines.forEach((line, li) => {
    // ลำดับโทเค็นในบรรทัด: `ชื่อ` หรือ L123 / ~L42-105 / L3919/L4046
    const tokRe = /`([^`]+)`|~?L(\d+)(?:-\d+)?/g;
    let pending = [];
    let lastWasL = false;
    const pairs = []; // [name, line]
    let m;
    const lQueue = [];
    let prevEnd = 0;
    while ((m = tokRe.exec(line))) {
      // ชื่อต้องติดกับเลขบรรทัด (คั่นได้แค่ช่องว่างหรือ /) — มีข้อความอื่นคั่น = ไม่ใช่คู่กัน เช่น (คีย์ `x`, ...) หรือ (push ... ~L4583)
      const gap = line.slice(prevEnd, m.index).trim();
      prevEnd = tokRe.lastIndex;
      if (gap && gap !== '/' && !lQueue.length) { pending = []; lastWasL = false; }
      if (m[1] !== undefined) {
        if (lastWasL) { pending = []; lastWasL = false; }
        pending.push(m[1]);
      } else {
        lQueue.push(Number(m[2]));
        lastWasL = true;
        // จับคู่ทีละตัวเมื่อเจอ L หลายตัวติดกัน (`a`/`b` L1/L2) — L ตัวเดียวกับหลายชื่อ = ทุกชื่อใช้ L เดียวกัน
        const next = line.slice(tokRe.lastIndex);
        if (!/^\s*\/\s*~?L\d/.test(next)) {
          const names = pending.map((x) => x.replace(/\(\)$/, '').trim()).filter((x) => /^[A-Za-z_$][\w$]*$/.test(x));
          if (names.length && lQueue.length === names.length) names.forEach((n, i) => pairs.push([n, lQueue[i]]));
          else names.forEach((n) => pairs.push([n, lQueue[0]]));
          lQueue.length = 0;
        }
      }
    }
    for (const [name, want] of pairs) {
      mapChecked++;
      const found = findDef(name);
      const where = `codebase-map บรรทัด ${li + 1}`;
      if (!found.length) { err(`(ค) ${where}: \`${name}\` (L${want}) ไม่พบการประกาศใน index.html`); continue; }
      const nearest = found.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a));
      if (Math.abs(nearest - want) > LINE_TOLERANCE) warn(`(ค) ${where}: \`${name}\` ระบุ L${want} แต่จริงอยู่ L${nearest} (ต่าง ${nearest - want})`);
    }
  });
}

// ---------- (ง) BACKUP_EXTRA_ROOT_KEYS ----------
function backupKeys(p) {
  if (!fs.existsSync(p)) { err(`(ง) ไม่พบ ${rel(p)}`); return null; }
  const m = /BACKUP_EXTRA_ROOT_KEYS\s*=\s*\[([^\]]*)\]/.exec(read(p));
  if (!m) { err(`(ง) ${rel(p)}: ไม่พบ BACKUP_EXTRA_ROOT_KEYS = [...]`); return null; }
  return new Set((m[1].match(/['"]([^'"]+)['"]/g) || []).map((x) => x.slice(1, -1)));
}
const kIdx = backupKeys(indexPath);
const kGs = backupKeys(path.join(ROOT, 'backend', 'BackupTrigger.gs'));
if (kIdx && kGs) {
  const onlyIdx = [...kIdx].filter((k) => !kGs.has(k));
  const onlyGs = [...kGs].filter((k) => !kIdx.has(k));
  if (onlyIdx.length) err(`(ง) BACKUP_EXTRA_ROOT_KEYS มีใน index.html แต่ไม่มีใน backend/BackupTrigger.gs → ${onlyIdx.join(', ')}`);
  if (onlyGs.length) err(`(ง) BACKUP_EXTRA_ROOT_KEYS มีใน backend/BackupTrigger.gs แต่ไม่มีใน index.html → ${onlyGs.join(', ')}`);
}

// ---------- report ----------
console.log('ตรวจสกิลทีม agent Karmto');
console.log(`- agent ${Object.keys(agents).length} ตัว, สกิล ${allSkills.length} ตัว, รายการใน codebase-map ${mapChecked} จุด, คีย์สำรอง ${kIdx ? kIdx.size : '?'}/${kGs ? kGs.size : '?'}`);
for (const e of errors) console.log('ERROR ' + e);
for (const w of warns) console.log('WARN  ' + w);
console.log(errors.length ? `ไม่ผ่าน: ERROR ${errors.length}, WARN ${warns.length}` : `ผ่าน: ERROR 0, WARN ${warns.length}`);
process.exit(errors.length ? 1 : 0);
