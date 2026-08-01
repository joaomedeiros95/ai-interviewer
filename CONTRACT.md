# API & Data Contract — FROZEN after foundation commit

Any change to this file, `interviews/models.py`, `interviews/urls.py`, or
`requirements.txt` requires cross-agent coordination. Everything else is
owned per the work split (engine/API = Agent A, frontend = Agent B,
deploy/docs = Agent C).

## Models

- **Job**: `title`, `description`, `question_pack` JSON:
  `{"topics": [{"id": int, "category": "behavioral"|"technical", "question": str, "signals": [str]}]}`
- **InterviewSession**: UUID pk, `job` FK, `status` (`active`|`completed`),
  `state` JSON: `{topic_cursor, followups_used, questions_asked, signals, gaps, covered_topic_ids}`,
  `evaluation` JSON (null until complete), `created_at`, `completed_at`
- **Turn**: `session` FK, `index` (unique per session), `role` (`interviewer`|`candidate`),
  `text`, `meta` JSON (interviewer turns: `{kind: "primary"|"followup", topic_id, rationale}`)

## Engine policy (deterministic)

- Each pack has 5 topics. Interview = exactly 7 interviewer questions
  (5 primary + 2 follow-ups).
- Q1 = pack topic 1 templated with the job title. No LLM call.
- After each candidate answer, ONE structured-output LLM call returns
  `{signals_detected, gaps, followup_warranted, followup_question, next_primary_question, rationale}`.
- Choose FOLLOW-UP if `followups_used < 2` AND (`followup_warranted` OR `questions_asked >= 5`).
  Otherwise next primary topic.
- On LLM exception: serve next pack question verbatim, `rationale: "fallback"`.
- After 7th answer: evaluation call → `{strengths: [str], concerns: [str], overall_score: int (1-10), summary: str}`,
  session → `completed`.

## Endpoints

### `POST /api/jobs/<int:job_id>/sessions/`
Creates a session, returns the first question.

```json
201
{
  "session_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "question": {"index": 0, "text": "To start: tell me about a recent project you're proud of as a Backend Engineer.", "meta": {"kind": "primary", "topic_id": 1, "rationale": "opening question from pack"}},
  "done": false
}
```

### `POST /api/sessions/<uuid>/answers/`  body: `{"text": "..."}`
Records the candidate answer, advances the engine.

```json
200 (mid-interview)
{
  "question": {"index": 2, "text": "You mentioned Redis caching — how did you handle invalidation?", "meta": {"kind": "followup", "topic_id": 1, "rationale": "Candidate mentioned caching without detail on invalidation strategy."}},
  "done": false,
  "decision_panel": {
    "signals": [{"skill": "system design", "evidence": "described cache-aside pattern"}],
    "gaps": ["no mention of testing strategy"],
    "covered_topics": [1],
    "followups_used": 1,
    "rationale": "Candidate mentioned caching without detail on invalidation strategy."
  },
  "evaluation": null
}
```

```json
200 (interview complete — after the 7th answer)
{
  "question": null,
  "done": true,
  "decision_panel": {"signals": [...], "gaps": [...], "covered_topics": [1,2,3,4,5], "followups_used": 2, "rationale": "interview complete"},
  "evaluation": {"strengths": ["clear system design reasoning"], "concerns": ["limited testing depth"], "overall_score": 7, "summary": "Solid candidate with..."}
}
```

Errors: `404` unknown session; `409 {"error": "session already completed"}`;
`400 {"error": "text is required"}`.

### `GET /api/sessions/<uuid>/`

```json
200
{
  "session_id": "9b1deb4d-...",
  "job": {"id": 1, "title": "Backend Engineer", "description": "..."},
  "status": "completed",
  "turns": [
    {"index": 0, "role": "interviewer", "text": "...", "meta": {"kind": "primary", "topic_id": 1, "rationale": "..."}},
    {"index": 1, "role": "candidate", "text": "...", "meta": {}}
  ],
  "evaluation": {"strengths": [], "concerns": [], "overall_score": 7, "summary": "..."}
}
```

## Pages

- `GET /` — job list (template: `interviews/job_list.html`, context: `jobs`)
- `GET /interview/<uuid>/` — room (template: `interviews/room.html`, context: `session`)
- `GET /results/<uuid>/` — results (template: `interviews/results.html`, context: `session`)

## CSRF

Room template emits `<meta name="csrf-token" content="{{ csrf_token }}">`;
JS sends it as the `X-CSRFToken` header on every POST.

## File ownership

| Agent | Files |
|---|---|
| A (engine/API) | `interviews/engine.py`, `interviews/llm.py`, `interviews/prompts.py`, `interviews/api.py`, `interviews/management/**`, `interviews/tests.py` |
| B (frontend) | `templates/**`, `static/**`, `interviews/views.py` (context only, keep template names) |
| C (deploy/docs) | `Dockerfile`, `entrypoint.sh`, `render.yaml`, `.env.example`, `README.md` |
