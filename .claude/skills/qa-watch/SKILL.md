---
name: qa-watch
description: 웹 런처(scripts/qa-server.mjs)가 남긴 일감 파일(reports/_qa_request.json)을 한 번 확인해, 대기 중인 QA 요청이 있으면 design-qa를 실행하고 결과를 reports/_qa_result.json에 기록한다. 보통 `/loop 30s /qa-watch`처럼 루프로 돌린다.
---

# QA 감시 — 한 틱(tick)

웹 런처 버튼이 만든 일감을 집어 QA를 돌리는 **단발 작업**이다. 루프(`/loop`)가 이 스킬을 주기적으로 호출한다.
Figma MCP는 **이 인터랙티브 세션에만** 연결돼 있으므로, 헤드리스가 아닌 바로 여기서 figma를 읽어야 한다.

## 절차

1. **일감 확인** — `reports/_qa_request.json`을 Read한다(Bash `cat` 가능).
   - 파일이 없거나 JSON 파싱 실패 → **아무것도 하지 말고** "대기 중(요청 없음)"만 한 줄로 보고하고 끝낸다. (루프 비용 최소화)
   - `status`가 `pending`이 **아니면**(이미 `running`/`done`) → 역시 아무것도 안 하고 "대기 중"으로 끝낸다.

2. **선점(중복 실행 방지)** — `pending`이면 즉시 같은 파일을 `status: "running"`으로 덮어쓴다(Write). 그래야 다음 루프 틱이 같은 일감을 다시 잡지 않는다.

3. **QA 실행** — 일감의 `figmaUrl`/`webUrl`/`width`/`scale`을 입력으로 **`design-qa` 스킬을 그대로 따른다.**
   - `width`/`scale`이 `null`이면 design-qa 기본 규칙대로(폭은 `get_metadata`에서, scale 기본 2).
   - 단일 모드로 처리한다(런처는 단일 프레임 기준). 리포트는 `reports/qa-report.html`.

4. **결과 기록** — 끝나면 `reports/_qa_result.json`을 Write한다:
   - 성공: `{ "id": "<일감 id>", "status": "done", "report": "reports/qa-report.html" }`
   - 실패(캡처/ MCP 오류 등): `{ "id": "<일감 id>", "status": "error", "message": "<디자이너 친화 메시지>" }`
     - design-qa의 "결과 전달" 규칙대로 사람이 읽을 한국어 메시지로 번역한다(원문 exit 코드 금지).
   - 그리고 `reports/_qa_request.json`의 `status`도 `done`(또는 `error`)으로 바꿔 마무리한다.

5. **보고** — 메인에는 한 줄 요약만(예: "결제창 QA 완료 — 리포트 생성됨" 또는 "대기 중"). 무거운 데이터는 design-qa/qa-analyzer 안에서 소비한다.

## 주의
- 일감이 없을 때의 틱은 **반드시 가볍게**(파일 한 번 읽고 끝). 불필요한 도구 호출 금지 — 루프가 토큰을 계속 먹는다.
- 런처는 figma를 직접 읽지 않는다(헤드리스 OAuth 미인증). figma 읽기는 **이 세션**의 몫이다.
- 결과 파일의 `id`는 **일감의 `id`와 정확히 같아야** 런처가 그 결과를 인식한다.
