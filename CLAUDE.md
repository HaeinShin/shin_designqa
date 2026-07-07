# shin-designqa

개인용 **디자인 QA 하네스**. Figma 디자인과 로컬 웹 구현이 일치하는지 비교해 한 장짜리 리포트를 만든다.

## 핵심 흐름
1. **메인**이 **Figma MCP**로 프레임 데이터를 읽어 `reports/figma-*` 파일로 덤프한다.
2. **`qa-analyzer` 서브에이전트**가 **Playwright**(`scripts/capture.mjs`)로 로컬 웹을 캡처(스크린샷 + computed style)하고, Figma 파일과 비교·분석해 `reports/qa-report.html`을 생성한다.
3. 메인은 짧은 요약만 받아 사용자에게 보여주고 `open`으로 리포트를 연다.

→ 이 전체 절차는 **`design-qa` 스킬**(오케스트레이션)에 정의되어 있다. "디자인 QA 해줘" + Figma URL + 로컬 웹 URL 이면 그 스킬을 따른다.

## 역할 분담 (중요)
**Figma MCP는 메인 세션에만 연결돼 있어 서브에이전트는 MCP를 못 쓴다.** 그래서:
- **메인**: Figma MCP 읽기 → 원본을 **곱씹지 말고 파일로 덤프** → 경로만 서브에이전트에 전달.
  - `get_design_context` → `reports/figma-code.txt` (CSS 값 1차 출처)
  - `get_metadata` → `reports/figma-meta.xml` (위치/크기/구조)
  - `get_variable_defs` → `reports/figma-tokens.json` (선택)
  - `download_assets`(임시 URL 반환) → `curl -o reports/figma.png "<url>"` (기준 이미지)
- **`qa-analyzer` 서브에이전트**: MCP 미사용. 전달받은 Figma 파일 + 웹 캡처(직접 실행)로 **500요소 비교·리포트 작성**만 하고 **짧은 요약만** 반환.
- 메인에서 `web-styles.json`(500요소)·캡처 스크린샷을 **직접 읽지 말 것.**
- **반응형 QA**: 메인이 브레이크포인트별 Figma 데이터를 저장한 뒤 `qa-analyzer`를 **병렬 호출** → 각자 리포트 작성 → 메인은 작은 합본 인덱스만 만든다.ㅇ

## 원칙 (가볍게·심플하게)
- 비교/분석은 **코드 diff 엔진이 아니라 Claude가 직접** 판단한다.
- Figma는 **MCP만** 사용 — REST API·개인 토큰·무거운 로직 금지.
- 의존성은 **Playwright 하나**. 새 의존성·서버·로그인 추가하지 말 것.
- 리포트(`reports/`)는 임시 파일 — 매번 덮어써도 됨.
- **실패하면 추측하지 말 것**: 캡처가 비-0 종료하거나 Figma 데이터가 부족하면 리포트를 만들지 말고 원인을 알린다.
- **스타일/레이아웃 QA에 집중** — 더미↔실데이터 같은 콘텐츠 텍스트 값 차이는 결함이 아니다. 폰트 차이는 보수적으로(헤드리스 폰트 미설치 가능성).
- **리포트 UX**: 한국어 + **시각 비교가 주인공**(스와이프·오버레이·나란히) + 행동 가능한 로케이터. **합격/불합격 판정·실패·빨강 강조 금지** — 차이를 크기순(🟠주목/▫️미세/◇확인)으로 정리만 하고 판단은 디자이너 몫.
- 에러는 디자이너 친화적으로 번역해 전달(원문 exit 코드 던지지 말 것).

## 명령어
- 최초 1회 셋업: `npm run setup` (Playwright + Chromium 설치)
- 웹 캡처: `node scripts/capture.mjs "<url>" reports/web [width] [scale]`
  - 종료 코드: `0`성공 · `1`URL/인자 오류 · `2`접속 실패(서버 미기동) · `3`타임아웃 · `4`기타
  - dev 서버 HMR 때문에 `networkidle` 대신 `domcontentloaded` 기준으로 동작한다.
- **버튼으로 QA(웹 런처)**: `npm run launcher` → http://localhost:4567 에서 Figma·웹 URL 입력 후 버튼.
  - 동작 원리: 런처 서버(`scripts/qa-server.mjs`, Node 내장 http만 사용)는 figma를 **직접 안 읽는다**. 버튼이 `reports/_qa_request.json`(일감)을 쓰면, **열려 있는 인터랙티브 세션**의 감시 루프가 그걸 집어 design-qa를 돌리고 `reports/_qa_result.json`을 남긴다 → 런처가 리포트를 연다.
  - 세션에서 감시 켜기: `/loop 1m /qa-watch` (figma MCP는 인터랙티브 세션에만 인증돼 있어, QA 실행 주체는 반드시 이 세션이다).
  - **왜 헤드리스 자동화는 안 되나**: `claude -p`(백그라운드) 세션의 figma MCP는 OAuth 미인증 상태로 떠서 `authenticate` 두 개만 노출한다(토큰은 macOS Keychain·인터랙티브 전용). 그래서 "버튼→백그라운드가 알아서"는 불가, "버튼→열린 세션이 처리"만 가능.

## 환경
- macOS (`open` 명령으로 리포트 자동 열기), Node 18+ 필요.
- 정확한 비교를 위해 캡처 `width`/`scale`을 Figma 프레임에 맞춘다 (폭은 `get_metadata`로 획득).

## 구조
- `.claude/skills/design-qa/` — QA 오케스트레이션(입력 수집 → 위임 → 요약 전달)
- `.claude/skills/qa-watch/` — 웹 런처 일감(`_qa_request.json`)을 집어 design-qa를 돌리는 감시 틱(`/loop`로 반복)
- `.claude/agents/qa-analyzer.md` — 비교·분석 워커(무거운 데이터 전담, 짧은 요약 반환)
- `scripts/capture.mjs` — Playwright 캡처
- `scripts/qa-server.mjs` + `scripts/launcher.html` — 웹 런처(버튼으로 QA 트리거)
- `reports/` — 산출물: `figma-code.txt`/`figma-meta.xml`/`figma-tokens.json`/`figma.png`(메인 덤프), `web.png`/`web-styles.json`(캡처), `qa-report.html`/브레이크포인트별 리포트
- `README.md` — 사람용 사용법(셋업·예시·문제 해결)
- `기획서.md` — 제품 기획

## 참고
- Figma MCP 연결 계정: haein.shin@nhn.com
