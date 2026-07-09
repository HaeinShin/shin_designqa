---
name: qa-watch
description: 웹 런처(scripts/qa-server.mjs)가 남긴 일감 파일(reports/_qa_request.json)을 한 번 확인해, 대기 중인 QA 요청이 있으면 design-qa를 실행하고 결과를 reports/_qa_result.json에 기록한다. 보통 `/loop 1m /qa-watch`처럼 루프로 돌린다.
---

# QA 감시 — 한 틱(tick)

웹 런처 버튼이 만든 일감을 집어 QA를 돌리는 **단발 작업**이다. 루프(`/loop`)가 이 스킬을 주기적으로 호출한다.
Figma MCP는 **이 인터랙티브 세션에만** 연결돼 있으므로, 헤드리스가 아닌 바로 여기서 figma를 읽어야 한다.

## ⚠️ 무질문 원칙 (가장 중요)

이 틱은 **완전 자동 처리**다. 사용자에게 어떤 것도 묻지 말 것.
- 입력 확인, 단일/반응형 여부, URL 재확인 — 전부 금지.
- 오류가 생기면 사용자에게 묻지 말고 `_qa_result.json`에 `status: "error"`로 기록하고 끝낸다.

## 절차

0. **중단 요청 확인** — 하트비트보다 먼저: `reports/_loop_stop.json` 파일이 있으면:
   1. `rm -f reports/_loop_stop.json` (Bash 실행)
   2. CronList → qa-watch 관련 잡 전부 CronDelete
   3. 하트비트 갱신 없이 종료한다 (런처가 곧 "대기 없음"으로 전환됨)

0. **하트비트 기록** — 매 틱 시작 시 `reports/_loop_heartbeat.json`을 **실제 현재 시각**으로 갱신한다(런처가 이 파일로 루프 활성 여부를 판단).
   - **반드시 Bash로** 아래 명령어를 실행해 실제 현재 시각을 기록한다. 타임스탬프를 손으로 작성하거나 Write 도구로 고정 문자열을 쓰면 서버가 "꺼짐"으로 판단하므로 절대 금지.
   - ```bash
     node -e "require('fs').writeFileSync('reports/_loop_heartbeat.json', JSON.stringify({tick:new Date().toISOString()}))"
     ```
   - Bash 명령이 실패해도 계속 진행한다(하트비트는 non-critical).

1. **일감 확인** — `reports/_qa_request.json`을 Read한다(Bash `cat` 가능).
   - 파일이 없거나 JSON 파싱 실패 → **아무것도 하지 말고** "대기 중(요청 없음)"만 한 줄로 보고하고 끝낸다. (루프 비용 최소화)
   - `status`가 `"running"`이면 → **아무 메시지도 출력하지 말고 조용히 종료한다.** (QA 진행 중 — 사용자에게 노이즈 방지. 하트비트는 이미 0단계에서 갱신됐으므로 런처 배지는 초록 유지)
   - `status`가 `"done"`이면 → 역시 아무것도 안 하고 조용히 종료한다.

2. **선점(중복 실행 방지)** — `pending`이면 즉시 같은 파일을 `status: "running"`으로 덮어쓴다(Write). 그래야 다음 루프 틱이 같은 일감을 다시 잡지 않는다.
   - 이전 phase2 결과가 남아있으면 제거: `rm -f reports/_qa_detail_ready.json` (Bash 실행, 실패해도 계속)

3. **QA 실행** — 일감 JSON에서 `figmaUrl`/`webUrl`/`width`/`scale`/`mode`/`id`를 꺼내 **사용자에게 아무것도 묻지 않고** 아래 순서대로 직접 수행한다. design-qa의 **1단계(입력 수집)는 건너뛴다** — 입력은 이미 확보됐다.
   - `mode`가 없으면 `"full"`로 간주한다.

   a. **Figma MCP 읽기 (design-qa 2단계에 해당)** — `figmaUrl`에서 `fileKey`/`nodeId`(`-`→`:`) 추출 후:

      **▶ `mode === "visual"` (빠른 시각 비교)** — 2개만 병렬 실행:
      - `get_metadata` → `reports/figma-meta.xml` 저장 (`width`가 null이면 여기 bounding box 폭 사용)
      - `download_assets` → 반환 URL을 `curl -o reports/figma.png "<url>"` 로 저장
      - `reports/figma-code.txt` / `reports/figma-tokens.json` 은 건드리지 않는다(없어도 됨).

      **▶ `mode === "full"` (상세 QA 분석)** — 4개 동시에(병렬로) 실행:
      - `get_design_context` (**반드시 `disableCodeConnect: true`** 로 호출 — Code Connect 프롬프트가 출력되면 사용자에게 질문하게 되므로 항상 비활성화) → `reports/figma-code.txt` 저장
        - `get_design_context`가 Code Connect 안내 텍스트만 반환하고 코드가 없으면 → **사용자에게 묻지 말고** 즉시 `disableCodeConnect: true`로 재호출한다.
        - 파일 저장은 Bash `cat >` heredoc을 사용한다.
      - `get_metadata` → `reports/figma-meta.xml` 저장 (`width`가 null이면 여기 bounding box 폭 사용) — Bash `cat >` heredoc 사용.
      - `get_variable_defs` → `reports/figma-tokens.json` 저장 (실패해도 계속 진행)
        - ⚠️ **반드시 Write 도구 사용** — `cat > << 'EOF'` 로 JSON을 heredoc 저장하면 `{"` 패턴이 Claude Code 보안 검사를 트리거해 승인 프롬프트가 뜬다. 이를 막기 위해:
          1. `Bash: rm -f reports/figma-tokens.json` 실행 (파일 삭제 → 신규 파일로 인식)
          2. `Write 도구`로 `reports/figma-tokens.json` 에 토큰 JSON 저장
      - `download_assets` → 반환 URL을 `curl -o reports/figma.png "<url>"` 로 저장 (실패해도 계속 진행)

   b. **qa-analyzer 호출 (design-qa 3-A단계에 해당)** — **단일 모드 고정** (런처는 단일 프레임 기준).

      **▶ `mode === "visual"`** — qa-analyzer를 `mode="visual"`로 호출한다. 아래 경로 전달:
      `figmaCodePath=reports/figma-code.txt`, `figmaMetaPath=reports/figma-meta.xml`, `figmaTokensPath=reports/figma-tokens.json`(있으면), `figmaImagePath=reports/figma.png`(없으면 "이미지 없음" 명시), `webUrl`(없으면 null), `width`(null이면 meta에서 추출한 값), `outPrefix=reports/web`, `reportPath=reports/qa-report.html`, `mode=visual`
      - `scale`이 null이면 기본값 1 사용.
      - **`webImageProvided: true`인 경우** — "웹 캡처 건너뜀 — reports/web.png 사용 (사용자 업로드 스크린샷)"을 명시하고, `webUrl` 대신 `webImagePath=reports/web.png`를 전달한다.
      → qa-analyzer 완료 후 아래 4단계(결과 기록)로 이동.

      **▶ `mode === "full"` (프로그레시브 렌더링 — 2단계):**

      **Phase 1** — qa-analyzer를 `mode="phase1"`로 호출 (이미지 비교 + 스피너 리포트):
      `figmaCodePath=reports/figma-code.txt`, `figmaMetaPath=reports/figma-meta.xml`, `figmaImagePath=reports/figma.png`(없으면 "이미지 없음" 명시), `webUrl`(없으면 null), `width`, `scale`, `outPrefix=reports/web`, `reportPath=reports/qa-report.html`, `mode=phase1`
      - `scale`이 null이면 기본값 1 사용.
      - `webImageProvided: true`이면 `webImagePath=reports/web.png` 전달, 캡처 건너뜀.
      → Phase 1 완료 후 바로 4단계(결과 기록)로 이동.

4. **결과 기록 + 리포트 자동 오픈** — qa-analyzer(phase1 또는 visual) 완료 직후:
   - `reports/_qa_result.json`을 Bash node 명령으로 기록한다:
     - 성공: `{ "id": "<일감 id>", "status": "done", "report": "reports/qa-report.html" }`
     - 실패(캡처/ MCP 오류 등): `{ "id": "<일감 id>", "status": "error", "message": "<디자이너 친화 메시지>" }`
       - design-qa의 "결과 전달" 규칙대로 사람이 읽을 한국어 메시지로 번역한다(원문 exit 코드 금지).
   - 그리고 `reports/_qa_request.json`의 `status`도 `done`(또는 `error`)으로 바꿔 마무리한다.
   - **성공 시 리포트 자동 오픈** — 반드시 Bash로 실행(실패해도 계속):
     ```bash
     open "http://localhost:4567/reports/qa-report.html"
     ```

4.5. **Phase 2 실행 (full 모드만)** — 결과 기록 직후, 이어서 qa-analyzer를 `mode="phase2"`로 호출 (CSS 분석):
   `figmaCodePath=reports/figma-code.txt`, `figmaMetaPath=reports/figma-meta.xml`, `figmaTokensPath=reports/figma-tokens.json`(있으면), `webStylesPath=reports/web-styles.json`, `detailOutputPath=reports/_qa_detail_ready.json`, `mode=phase2`
   - Phase 2는 `_qa_detail_ready.json`을 완성하면 끝. 리포트 파일은 건드리지 않는다.
   - 열린 리포트 페이지의 폴링 JS가 `_qa_detail_ready.json`을 감지해 스피너를 상세 내용으로 교체한다.
   - visual 모드, phase1 실패, 또는 `webImageProvided: true`인 경우에는 이 단계를 건너뛴다. (webImageProvided 시 캡처를 건너뛰어 styles.json이 없으므로 CSS 분석 불가)
   - Phase 2 실패 시: `_qa_result.json`을 재기록하지 말 것 — 이미 done이고 리포트도 열려 있다. 보고만 한다.

5. **보고** — 메인에는 한 줄 요약만(예: "결제창 QA 완료 — 리포트 생성됨" 또는 "대기 중").
   - full 모드는 phase2까지 끝난 후: "QA 완료 — 리포트 열림 + CSS 상세 분석 완료" 형태.
   - 무거운 데이터는 design-qa/qa-analyzer 안에서 소비한다.

## 주의
- 일감이 없을 때의 틱은 **반드시 가볍게**(파일 한 번 읽고 끝). 불필요한 도구 호출 금지 — 루프가 토큰을 계속 먹는다.
- 런처는 figma를 직접 읽지 않는다(헤드리스 OAuth 미인증). figma 읽기는 **이 세션**의 몫이다.
- 결과 파일의 `id`는 **일감의 `id`와 정확히 같아야** 런처가 그 결과를 인식한다.
