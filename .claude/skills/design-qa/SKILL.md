---
name: design-qa
description: Figma 프레임과 로컬 웹 화면을 비교해 디자인 QA 리포트(qa-report.html)를 생성한다. 사용자가 Figma URL과 로컬 웹 URL(예: localhost:3000)을 주며 "디자인 QA", "피그마랑 웹 비교", "QA 리포트 만들어줘", "반응형 QA"라고 할 때 사용.
---

# Design QA — 오케스트레이션

메인(너)이 **Figma MCP 읽기만** 직접 하고, 무거운 분석·리포트 작성은 `qa-analyzer` 서브에이전트에 위임한다.

> ⚠️ **왜 이 구조인가**: Figma MCP는 **메인 세션에만** 연결돼 있어 서브에이전트는 MCP를 못 쓴다.
> 그래서 메인이 Figma 데이터를 **파일로 저장**해 넘기고, 서브에이전트는 그 파일 + 웹 캡처로 비교만 한다.
>
> ⚠️ **컨텍스트 보호**: 메인에서 `web-styles.json`(500요소)·캡처 스크린샷은 **읽지 마라.** 비교·리포트는 `qa-analyzer`가 한다. 메인은 Figma MCP 결과를 **곱씹지 말고 파일로 떨군 뒤** 서브에이전트를 호출하고, 요약만 relay한다.

## 1. 입력 모으기
- **Figma 프레임 URL**(node-id 포함), **로컬 웹 URL**. 없으면 사용자에게 요청.
- 단일인지 **반응형(멀티 브레이크포인트)**인지 확인.
  - 단일: 폭 미지정 시 `get_metadata` 폭을 사용. 특정 폭 원하면 받는다.
  - 반응형: 브레이크포인트마다 `{label, figmaUrl, width}` 세트 (웹 URL은 보통 공통).
    - 기본값 제안: **모바일 375 / 태블릿 768 / 데스크톱 1440**. 사용자가 다른 값을 주면 그걸 우선.
- 사전 준비: `mkdir -p reports`.
- **첫 실행 자동 감지**: `node_modules/playwright` 가 없으면 멈추지 말고 "최초 1회 설치(약 170MB)가 필요해요"라고 알린 뒤 `npm run setup` 을 실행한다.

## 2. Figma MCP 읽기 → 파일 저장 (메인이 직접, 프레임마다)
URL에서 `fileKey`·`nodeId`(`-`→`:`) 추출. 프레임(또는 브레이크포인트)마다 `<suffix>`(단일은 없음, 반응형은 `-mobile` 등) 붙여 저장:
- `get_design_context` → 참조 코드를 **`reports/figma-code<suffix>.txt`** 로 저장(Write). **실제 CSS 값의 1차 출처.**
- `get_metadata` → XML을 **`reports/figma-meta<suffix>.xml`** 로 저장. 폭 미지정 시 여기 bounding box 폭 사용.
- 필요시 `get_variable_defs` → **`reports/figma-tokens<suffix>.json`** 로 저장.
- `download_assets`(임시 URL 반환) → 반환된 export URL을 **`curl -o reports/figma<suffix>.png "<url>"`** 로 저장. (URL은 곧 만료되므로 즉시.)
  - 실패/미지원 → 이미지 없이 진행하고 서브에이전트에 "이미지 없음" 전달.
- **폴백**: `get_design_context` 가 크기 때문에 코드 대신 메타만 반환하면, 코드 파일은 비워두고(또는 생략) 서브에이전트에 알린다. (속성 비교 정밀도 하락)
- **MCP 실패**(권한/비공개/잘못된 node-id) → 추측 말고 사용자에게 알리고 중단.

> 목적은 "저장 후 위임". MCP 원본을 메인에서 분석·요약하지 말 것. 받은 그대로 파일로 떨구고 다음 단계로.

## 3-A. 단일 모드 — qa-analyzer 1개 호출
프롬프트에 경로 전달: `figmaCodePath=reports/figma-code.txt`, `figmaMetaPath=reports/figma-meta.xml`, `figmaTokensPath=reports/figma-tokens.json`(있으면), `figmaImagePath=reports/figma.png`(없으면 "이미지 없음" 명시), `webUrl`, `width`, `outPrefix=reports/web`, `reportPath=reports/qa-report.html`, `label`(선택).
반환 요약을 사용자에게 보여주고 → `open reports/qa-report.html`.

## 3-B. 반응형 모드 — qa-analyzer 병렬 호출
브레이크포인트별로 `qa-analyzer`를 **병렬로 동시에**(한 메시지에 여러 Agent 호출) 호출. 각자 `<suffix>` 경로:
- mobile → `figma-code-mobile.txt`/`figma-meta-mobile.xml`/`figma-mobile.png`, `outPrefix=reports/web-mobile`, `reportPath=reports/qa-report-mobile.html`, `width=375`
- tablet → `...-tablet...`, `width=768`
- desktop → `...-desktop...`, `width=1440`

모든 요약이 오면:
1. 작은 **합본 인덱스** `reports/qa-report.html` 생성 — 브레이크포인트별 요약 카드(🔴/🟡/⚪·체감 일치율)와 각 상세 리포트 링크. (요약만으로 만들어 가볍게.)
2. `open reports/qa-report.html`.

## 4. 결과 전달
- 각 qa-analyzer 요약(일치율·건수·주요 이슈·경고)을 간결히 보여준다.
- 실패 시 **디자이너 친화적으로 번역**해서 전달(원문 에러 코드 그대로 던지지 말 것):
  - 접속 실패(exit 2) → "로컬 서버가 안 떠 있는 것 같아요. 개발 서버(예: `npm run dev`)를 실행한 뒤 다시 시도해 주세요."
  - 타임아웃(exit 3) → "페이지 로딩이 너무 오래 걸려요. URL과 서버 상태를 확인해 주세요."
  - 로그인/빈 화면 캡처 의심 → "로그인 화면이 캡처된 것 같아요. QA할 실제 화면 URL을 알려주세요."
  - MCP 권한/비공개 → "Figma 파일 접근 권한이나 node-id를 확인해 주세요."
- 추측으로 리포트를 채우지 말 것.

## 원칙
- 메인은 Figma MCP 읽기·파일 저장·오케스트레이션만. 무거운 데이터는 `qa-analyzer`만 만진다.
- Figma는 **MCP만**(REST/토큰 금지). 의존성은 Playwright 하나.
- 데이터 부족·캡처 실패 시 추측 리포트 금지.
