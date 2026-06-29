---
name: feedback-qa-watch-no-questions
description: qa-watch 틱에서 사용자에게 질문하면 안 됨 — design-qa 스킬 경유 금지
metadata:
  type: feedback
---

qa-watch 틱 실행 중 사용자에게 어떤 질문도 하지 말 것.

**Why:** design-qa 스킬을 경유하면 스킬 내부 "입력 수집" 단계에서 질문이 발생한다. 런처 버튼은 완전 자동 처리를 기대하므로 질문이 나오면 안 된다.

**How to apply:** qa-watch에서는 design-qa 스킬을 호출하지 말 것. 대신 qa-watch SKILL.md 절차대로 Figma MCP 4개 도구를 직접 병렬 호출 → 파일 저장 → qa-analyzer 서브에이전트 호출 순으로 직접 처리. 오류가 생겨도 사용자에게 묻지 말고 `_qa_result.json`에 `status: "error"`로 기록하고 종료.
