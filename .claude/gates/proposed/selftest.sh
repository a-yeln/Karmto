#!/usr/bin/env bash
# ทดสอบ check-gates.js ใน repo ชั่วคราว (git init ใหม่ — ไม่แตะ repo จริง ไม่แตะเน็ต)
# ใช้: bash selftest.sh [โฟลเดอร์ทดลอง]   (ไม่ใส่ = mktemp -d)
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
CHECK="$HERE/check-gates.js"
WORK="${1:-$(mktemp -d)}"
WORK="$WORK/gates-selftest-$$"
mkdir -p "$WORK"
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.invalid GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.invalid
unset GITHUB_HEAD_REF CLAUDE_PROJECT_DIR

pass=0; fail=0
ok()  { pass=$((pass+1)); echo "  ✅ $1"; }
bad() { fail=$((fail+1)); echo "  ❌ $1"; [ -n "${2:-}" ] && echo "$2" | sed 's/^/       /'; }

# สร้าง origin (bare) + main ที่มี index.html / backend / docs
git init -q --bare -b main "$WORK/origin.git"
git clone -q "$WORK/origin.git" "$WORK/seed" 2>/dev/null
cd "$WORK/seed"
git checkout -q -b main
echo "<script>const APP_BUILD = '2026-11-17.1'</script>" > index.html
mkdir -p backend docs .claude/gates
echo "function doGet(){}" > backend/Code.gs
echo "# docs" > docs/a.md
echo "template" > .claude/gates/TEMPLATE.md
git add -A && git commit -qm base && git push -q origin main

newpr() { # $1 = ชื่อ branch → clone ใหม่ แล้วสร้าง branch
  rm -rf "$WORK/pr"; git clone -q "$WORK/origin.git" "$WORK/pr" 2>/dev/null; cd "$WORK/pr"; git checkout -q -b "$1"
}
fp() { node "$CHECK" --fingerprint; }
# $1 money result $2 money fp $3 sec result $4 sec fp $5 reason(optional)
results() {
  local f=".claude/gates/results/$(git rev-parse --abbrev-ref HEAD | tr '/' '-').md"
  mkdir -p .claude/gates/results
  {
    echo "| ด่าน | ผล | ลายนิ้วมือที่ตรวจ | เหตุผล/หมายเหตุ |"
    echo "|---|---|---|---|"
    echo "| เทสครบทุก spec | ผ่าน | $2 | |"
    [ "$1" != "-" ] && echo "| money-guard | $1 | $2 | ${5:-} |"
    [ "$3" != "-" ] && echo "| security-guard | $3 | $4 | ${5:-} |"
  } > "$f"
  git add -A && git commit -qm "gates: results"
}
run() { out="$(node "$CHECK" 2>&1)"; code=$?; }
expect() { # $1 ชื่อเคส $2 exit ที่คาด $3 ข้อความที่ต้องเจอ(optional)
  if [ "$code" = "$2" ] && { [ -z "${3:-}" ] || printf '%s' "$out" | grep -q -- "$3"; }; then ok "$1 (exit $code)"; else bad "$1 — ได้ exit $code คาด $2" "$out"; fi
}

echo "เคสทดสอบ check-gates.js"

# 1 ผ่านครบ (แตะ index.html, guard ผ่านทั้งคู่ ลายนิ้วมือตรง)
newpr claude/ok; echo "<p>x</p>" >> index.html; git commit -qam code; F=$(fp)
results ผ่าน "$F" ผ่าน "$F" "ตรวจแล้ว"; run; expect "1 ผ่านครบ" 0 "ครบและตรง"
printf '%s' "$out" | grep -q "คำเตือน" && ok "1b แถวอื่นขาด = แค่คำเตือน ไม่บล็อก" || bad "1b ควรมีคำเตือน" "$out"

# 2 ขาด money-guard
newpr claude/no-money; echo "<p>x</p>" >> index.html; git commit -qam code; F=$(fp)
results - "$F" ผ่าน "$F"; run; expect "2 ขาด money-guard" 1 "ขาดแถว money-guard"

# 3 ขาด security-guard
newpr claude/no-sec; echo "<p>x</p>" >> index.html; git commit -qam code; F=$(fp)
results ผ่าน "$F" - "$F"; run; expect "3 ขาด security-guard" 1 "ขาดแถว security-guard"

# 4 guard ไม่ผ่าน
newpr claude/fail; echo "<p>x</p>" >> index.html; git commit -qam code; F=$(fp)
results ไม่ผ่าน "$F" ผ่าน "$F"; run; expect "4 money-guard ไม่ผ่าน" 1 "ไม่ผ่าน"

# 5 แก้โค้ดหลังตรวจ → ลายนิ้วมือเปลี่ยน → บล็อก
newpr claude/late-edit; echo "<p>x</p>" >> index.html; git commit -qam code; F=$(fp)
results ผ่าน "$F" ผ่าน "$F"; echo "<p>แก้หลังตรวจ</p>" >> index.html; git commit -qam "late"; F2=$(fp)
[ "$F" != "$F2" ] && ok "5a แก้โค้ดหลังตรวจ ลายนิ้วมือเปลี่ยน" || bad "5a ลายนิ้วมือไม่เปลี่ยน"
run; expect "5b แก้โค้ดหลังตรวจ = บล็อก" 1 "ตรวจซ้ำ"

# 6 PR เอกสารอย่างเดียว "ไม่เกี่ยว" + เหตุผล
newpr claude/docs; echo "more" >> docs/a.md; git commit -qam docs; F=$(fp)
results ไม่เกี่ยว "$F" ไม่เกี่ยว "$F" "แก้แค่เอกสาร ไม่แตะ index.html/backend"; run; expect "6 PR เอกสาร ไม่เกี่ยว ถูกต้อง" 0

# 6b ไม่เกี่ยว แต่ไม่มีเหตุผล
newpr claude/docs-noreason; echo "more" >> docs/a.md; git commit -qam docs; F=$(fp)
results ไม่เกี่ยว "$F" ไม่เกี่ยว "$F" ""; run; expect "6b ไม่เกี่ยว ไม่มีเหตุผล = บล็อก" 1 "ไม่มีเหตุผล"

# 7 แตะ index.html แต่อ้าง "ไม่เกี่ยว"
newpr claude/lie; echo "<p>x</p>" >> index.html; git commit -qam code; F=$(fp)
results ไม่เกี่ยว "$F" ไม่เกี่ยว "$F" "แก้แค่เอกสาร"; run; expect "7 แตะ index.html แต่อ้างไม่เกี่ยว = ปฏิเสธ" 1 "แก้ index.html จริง"

# 7b แตะ backend/ แต่อ้าง "ไม่เกี่ยว"
newpr claude/lie-gs; echo "// x" >> backend/Code.gs; git commit -qam code; F=$(fp)
results ผ่าน "$F" ไม่เกี่ยว "$F" "ไม่เกี่ยว"; run; expect "7b แตะ backend/ แต่อ้างไม่เกี่ยว = ปฏิเสธ" 1 "backend/Code.gs"

# 8 เพิ่มไฟล์ผลด่านแล้วลายนิ้วมือไม่เปลี่ยน
newpr claude/stable; echo "<p>x</p>" >> index.html; git commit -qam code; F=$(fp)
results ผ่าน "$F" ผ่าน "$F"; F2=$(fp)
echo "| หมายเหตุเพิ่ม | | | |" >> ".claude/gates/results/claude-stable.md"; git commit -qam "edit results"; F3=$(fp)
[ "$F" = "$F2" ] && [ "$F" = "$F3" ] && ok "8 เพิ่ม/แก้ไฟล์ผลด่าน ลายนิ้วมือไม่เปลี่ยน" || bad "8 ลายนิ้วมือเปลี่ยน $F / $F2 / $F3"

# 9 ไม่ผ่าน → แก้เป็นผ่าน โดยลายนิ้วมือเดิม (ไม่ได้แก้โค้ด) = บล็อก
newpr claude/flip; echo "<p>x</p>" >> index.html; git commit -qam code; F=$(fp)
results ผ่าน "$F" ไม่ผ่าน "$F"; results ผ่าน "$F" ผ่าน "$F"; run; expect "9 กลับคำ ไม่ผ่าน→ผ่าน ลายนิ้วมือเดิม = บล็อก" 1 "กลับคำไม่ได้"

# 9b ไม่ผ่าน → แก้โค้ด → ตรวจใหม่ ผ่าน (ลายนิ้วมือใหม่) = ผ่านได้
newpr claude/fixed; echo "<p>x</p>" >> index.html; git commit -qam code; F=$(fp)
results ผ่าน "$F" ไม่ผ่าน "$F"; echo "<p>แก้แล้ว</p>" >> index.html; git commit -qam fix; F2=$(fp)
results ผ่าน "$F2" ผ่าน "$F2"; run; expect "9b แก้โค้ดแล้วตรวจใหม่ผ่าน = ปล่อย" 0

# 10 แถวซ้ำผลขัดกันในไฟล์เดียว
newpr claude/dup; echo "<p>x</p>" >> index.html; git commit -qam code; F=$(fp)
results ผ่าน "$F" ผ่าน "$F"; echo "| money-guard | ไม่ผ่าน | $F | |" >> .claude/gates/results/claude-dup.md; git commit -qam dup
run; expect "10 แถว money-guard ขัดกัน = บล็อก" 1 "ผลขัดกัน"

# 11 ไม่มีไฟล์ผลเลย
newpr claude/none; echo "<p>x</p>" >> index.html; git commit -qam code; run; expect "11 ไม่มีไฟล์ผล = บล็อก" 1 "ไม่มีไฟล์ผลด่าน"

# 12 แก้ตัวตรวจ/แม่แบบใน .claude/gates (นอก results/) ต้องเปลี่ยนลายนิ้วมือ
newpr claude/checker; echo "<p>x</p>" >> index.html; git commit -qam code; F=$(fp)
echo "แก้" >> .claude/gates/TEMPLATE.md; git commit -qam tpl; F2=$(fp)
[ "$F" != "$F2" ] && ok "12 แก้ไฟล์ใน .claude/gates นอก results/ = ลายนิ้วมือเปลี่ยน" || bad "12 ลายนิ้วมือไม่เปลี่ยน"

# 13 โหมด hook: ไม่ใช่คำสั่ง merge = ปล่อย / merge แต่ด่านไม่ครบ = exit 2 / MCP merge ครบ = ปล่อย
newpr claude/hook; echo "<p>x</p>" >> index.html; git commit -qam code; F=$(fp)
out="$(echo '{"tool_name":"Bash","tool_input":{"command":"ls"}}' | CLAUDE_PROJECT_DIR="$PWD" node "$CHECK" --hook 2>&1)"; code=$?
expect "13a hook: คำสั่งทั่วไป = ปล่อย" 0
out="$(echo '{"tool_name":"Bash","tool_input":{"command":"gh pr merge 150 --squash"}}' | CLAUDE_PROJECT_DIR="$PWD" node "$CHECK" --hook 2>&1)"; code=$?
expect "13b hook: gh pr merge ด่านไม่ครบ = exit 2" 2 "บล็อก merge"
results ผ่าน "$F" ผ่าน "$F"
out="$(echo '{"tool_name":"mcp__github__merge_pull_request","tool_input":{"pullNumber":150}}' | CLAUDE_PROJECT_DIR="$PWD" node "$CHECK" --hook 2>&1)"; code=$?
expect "13c hook: MCP merge ด่านครบ = ปล่อย" 0

# 14 ลายนิ้วมือคงที่แม้ main เดินหน้าในไฟล์อื่น แล้ว branch merge main เข้ามา
newpr claude/rebase; echo "<p>x</p>" >> index.html; git commit -qam code; F=$(fp)
results ผ่าน "$F" ผ่าน "$F"
( cd "$WORK/seed" && git pull -q origin main && echo more >> docs/a.md && git commit -qam other && git push -q origin main )
git fetch -q origin && git merge -q --no-edit origin/main; run; expect "14 merge main (ไฟล์อื่น) แล้วยังผ่าน" 0

echo
echo "สรุป: ผ่าน $pass / $((pass+fail)) เคส"
[ "$fail" = 0 ]
