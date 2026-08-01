# Application Flow

How one interview runs, end to end: the browser drives voice, the server owns
every decision. Policy source of truth is `interviews/engine.py`; the wire
format is [CONTRACT.md](../CONTRACT.md).

## 1. User journey

```mermaid
flowchart TD
    A["GET / — job list"] --> B{Pick a role}
    B --> C["POST /api/jobs/{id}/sessions/"]
    C --> D["Redirect to<br/>GET /interview/{uuid}/ — the room"]
    D --> E["Q1 read aloud (TTS)<br/>camera self-view optional"]
    E --> F["Click mic → speak → 'Stop &amp; submit'"]
    F --> G["POST /api/sessions/{uuid}/answers/"]
    G --> H{done?}
    H -- no --> I["Next question rendered + spoken<br/>decision panel updates"]
    I --> F
    H -- yes --> J["GET /results/{uuid}/<br/>transcript + evaluation"]
    J --> K["GET /sessions/ — history<br/>metrics, filter by role, replay"]
    K --> D
```

## 2. One answer, end to end

The core loop. Everything between "Stop & submit" and the next spoken question
is a single round trip.

```mermaid
sequenceDiagram
    autonumber
    actor C as Candidate
    participant B as Browser<br/>(interview.js / speech.js / video.js)
    participant W as Web Speech API<br/>(SpeechRecognition + speechSynthesis)
    participant A as Django API<br/>(interviews/api.py)
    participant E as Engine<br/>(interviews/engine.py)
    participant L as OpenAI<br/>(structured output)
    participant D as PostgreSQL

    C->>B: Click mic
    B->>W: recognition.start()
    W-->>B: interim + final transcript chunks
    C->>B: Click "Stop & submit"
    B->>W: cancel TTS, stop recognition
    B->>A: POST /answers/ {text} + X-CSRFToken

    A->>E: submit_answer(session, text)
    E->>D: SELECT … FOR UPDATE (lock session)
    E->>D: INSERT Turn(role=candidate)

    alt questions_asked < 7
        E->>L: analyze_turn(transcript, current + next topic)
        L-->>E: {signals_detected, gaps, followup_warranted,<br/>followup_question, next_primary_question, rationale}
        Note over E,L: on ANY exception → analysis = None,<br/>pack question served verbatim
        E->>E: merge signals + gaps, apply decision rule
        E->>D: INSERT Turn(role=interviewer), UPDATE state
        E-->>A: {question, done:false, decision_panel, evaluation:null}
    else 7th answer
        E->>L: evaluate_interview(full transcript, signals, gaps)
        L-->>E: {strengths, concerns, overall_score, summary}
        E->>D: UPDATE evaluation, status=completed, completed_at
        E-->>A: {question:null, done:true, decision_panel, evaluation}
    end

    A-->>B: 200 JSON
    alt done
        B->>C: "Interview complete" → redirect to /results/{uuid}/
    else next question
        B->>B: append turns, update decision panel
        B->>W: speechSynthesis.speak(next question)
        W-->>C: question read aloud
    end
```

## 3. The decision rule

Deterministic, in Python. The model proposes; the engine disposes — it never
decides how many questions to ask or when to stop.

```mermaid
flowchart TD
    S["Candidate answer received"] --> Q{questions_asked >= 7?}
    Q -- yes --> EV["Evaluation call → complete session"]
    Q -- no --> AN["analyze_turn LLM call"]
    AN --> OK{call succeeded?}
    OK -- no --> FB["analysis = None<br/>followup_warranted = false<br/>rationale = 'fallback'"]
    OK -- yes --> MG["merge signals + gaps into state"]
    FB --> DEC
    MG --> DEC{"followups_used &lt; 2<br/>AND<br/>(followup_warranted OR questions_asked &gt;= 5)"}
    DEC -- yes --> FU["FOLLOW-UP<br/>same topic_id, followups_used += 1"]
    DEC -- no --> PR["NEXT PRIMARY<br/>topic_cursor += 1, mark topic covered"]
    FU --> W["questions_asked += 1<br/>INSERT interviewer Turn<br/>save state"]
    PR --> W
```

Constants live in `engine.py`: `TOTAL_QUESTIONS = 7`, `MAX_FOLLOWUPS = 2`,
`FORCE_FOLLOWUP_AT = 5`.

Why every interview is exactly 5 primaries + 2 follow-ups:

- `MAX_FOLLOWUPS = 2` caps the top end — a chatty model can't run long.
- `FORCE_FOLLOWUP_AT = 5` covers the bottom end: once 5 questions have been
  asked, any remaining follow-up budget is spent. A model that never asks for
  a follow-up still produces two.

## 4. Session state machine

```mermaid
stateDiagram-v2
    [*] --> Active

    state Active {
        [*] --> Q1: Turn 0 from the pack (no LLM call)
        Q1 --> Answering
        Answering --> Deciding: POST /answers/
        Deciding --> Answering: question 2–7
    }

    Active --> Completed: 7th answer → evaluation stored
    Active --> Active: POST /answers/ on a locked row<br/>(serialized by SELECT FOR UPDATE)
    Completed --> Completed: POST /answers/ → 409 "session already completed"

    Completed --> [*]
```

Refreshing the room mid-interview is safe: `GET /api/sessions/<uuid>/` rebuilds
the transcript, and the decision panel's covered-topics and follow-up count are
re-derived from interviewer `Turn.meta` (`derivePanelFromTurns`).

## 5. Voice path in the browser

Voice is the only input path. No mic or no Web Speech API means the interview
cannot proceed, and the room says so explicitly rather than silently degrading.

```mermaid
flowchart LR
    subgraph TTS["Output — speechSynthesis"]
        T1["Question rendered"] --> T2{TTS toggle on?}
        T2 -- yes --> T3["speak()"]
        T2 -- no --> T4["silent — 'Replay' still forces it"]
        T3 -.-> T5["Chrome blocks pre-gesture audio →<br/>first pointerdown in the room retries<br/>(never on the mic button)"]
    end

    subgraph STT["Input — SpeechRecognition"]
        S1["Mic click"] --> S2["cancel TTS<br/>(don't transcribe our own voice)"]
        S2 --> S3["continuous + interimResults, en-US"]
        S3 --> S4{engine auto-stopped<br/>on silence?}
        S4 -- "user still wants to listen" --> S5["restart, capped at 8"]
        S5 --> S3
        S4 -- "user stopped" --> S6["accumulated final text → submit"]
    end
```

`video.js` is presentational only: it polls `speechSynthesis.speaking` every
250 ms to animate the interviewer tile, and manages an optional
`getUserMedia({video: true, audio: false})` self-view. Camera audio stays off —
the mic belongs to speech recognition — and a camera failure never blocks the
interview.

## 6. Failure handling

| Failure | Behavior |
|---|---|
| `analyze_turn` raises (no key, timeout, refusal, schema mismatch) | Logged at WARNING; next pack question served verbatim with `rationale: "fallback"`. The interview always completes. |
| `evaluate_interview` raises | `FALLBACK_EVALUATION` stored (`overall_score: 0`); session still marked `completed`. |
| Answer POST fails in the browser | Transcript is restored into the answer box — the candidate's words are never lost — and "Send answer" retries. |
| POST to a completed session | `409`; the browser redirects to `/results/{uuid}/`. |
| Answer body empty/malformed | `400 {"error": "text is required"}`. |
| Unknown session or job id | `404`. |
| No `SpeechRecognition` support or mic denied | Controls disabled with an explicit "voice-only, use Chrome or Edge" message. |
| Camera denied | Self-view stays a placeholder; interview continues. |
