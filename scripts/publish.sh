#!/bin/bash
# publish.sh — 개발 repo → 배포 repo 동기화 (복사만, 이동 없음)
# 사용법: bash scripts/publish.sh [배포_repo_경로]
# 기본 배포 경로: ../shin-designqa-plugin

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEV_ROOT="$(dirname "$SCRIPT_DIR")"
DEPLOY_ROOT="${1:-$(dirname "$DEV_ROOT")/shin-designqa-plugin}"

echo "▶ Design QA 플러그인 배포 동기화"
echo "  소스: $DEV_ROOT"
echo "  대상: $DEPLOY_ROOT"
echo ""

# 디렉토리 보장
mkdir -p "$DEPLOY_ROOT/.claude-plugin"
mkdir -p "$DEPLOY_ROOT/skills/design-qa"
mkdir -p "$DEPLOY_ROOT/skills/qa-watch"
mkdir -p "$DEPLOY_ROOT/agents"
mkdir -p "$DEPLOY_ROOT/scripts"
mkdir -p "$DEPLOY_ROOT/reports"

# skills 복사 (.claude/skills/ → skills/)
echo "  ✓ skills 복사"
cp "$DEV_ROOT/.claude/skills/design-qa/SKILL.md"           "$DEPLOY_ROOT/skills/design-qa/SKILL.md"
cp "$DEV_ROOT/.claude/skills/design-qa/report-template.html" "$DEPLOY_ROOT/skills/design-qa/report-template.html"
cp "$DEV_ROOT/.claude/skills/qa-watch/SKILL.md"            "$DEPLOY_ROOT/skills/qa-watch/SKILL.md"

# agents 복사 (.claude/agents/ → agents/)
echo "  ✓ agents 복사"
cp "$DEV_ROOT/.claude/agents/qa-analyzer.md" "$DEPLOY_ROOT/agents/qa-analyzer.md"
cp "$DEV_ROOT/.claude/agents/ui-designer.md" "$DEPLOY_ROOT/agents/ui-designer.md"

# scripts 복사 (start.mjs는 배포 repo 전용 — 복사 안 함)
echo "  ✓ scripts 복사"
cp "$DEV_ROOT/scripts/capture.mjs"   "$DEPLOY_ROOT/scripts/capture.mjs"
cp "$DEV_ROOT/scripts/launcher.html" "$DEPLOY_ROOT/scripts/launcher.html"
cp "$DEV_ROOT/scripts/qa-server.mjs" "$DEPLOY_ROOT/scripts/qa-server.mjs"

# package.json — private: true 제거
echo "  ✓ package.json 복사 (private 제거)"
node -e "
const pkg = JSON.parse(require('fs').readFileSync('$DEV_ROOT/package.json', 'utf8'));
delete pkg.private;
require('fs').writeFileSync('$DEPLOY_ROOT/package.json', JSON.stringify(pkg, null, 2) + '\n');
"

# CLAUDE.md — 개인정보 제거 버전
echo "  ✓ CLAUDE.md 복사 (배포용)"
cp "$DEV_ROOT/CLAUDE.deploy.md" "$DEPLOY_ROOT/CLAUDE.md"

echo ""
echo "✅ 완료! $DEPLOY_ROOT"
echo "   변경 사항은 배포 repo에서 git add → commit → push 하세요."
