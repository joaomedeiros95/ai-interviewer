# Manual E2E Test Plan

Human-executed test plan for the parts of the app that cannot be verified by
automated tests: microphone capture, speech recognition quality, text-to-speech,
camera, and browser permission flows. Automated coverage (engine policy, API
contract, fallbacks) lives in `interviews/tests.py`.

**Environment**: run against the live deployment — https://ai-interviewer-i6bx.onrender.com
(or `http://localhost:8000` via `docker compose up`).

**Prerequisites**
- Google Chrome or Edge on desktop, with a working microphone (and webcam for §6).
- Free-tier note: the first request after idle takes ~1 minute (cold start). Load
  the home page and wait for it before starting the clock on any test.
- A second browser (Firefox or Safari) for §8.2.

Mark each item ✅ / ❌. Anything ❌ → file it with the step number and what you saw.

---

## 1. Job list (home)

| # | Step | Expected |
|---|---|---|
| 1.1 | Open the base URL | Page loads; header shows brand + **History** link; three role cards (Backend Engineer, Frontend Engineer, Product Manager), each with a description and a **Start Interview** button |
| 1.2 | Click **Start Interview** on any role | Button shows "Starting…", then you land on `/interview/<uuid>/` — no console errors (F12 → Console) |

## 2. Interview room — first load

| # | Step | Expected |
|---|---|---|
| 2.1 | Observe the room after 1.2 | "Question 1 of 7" + progress bar; the first question mentions the role you picked; call strip shows **AI Interviewer** tile + **You** tile ("Camera off"); decision panel on the right shows empty states ("none yet", topic chips 1–5 uncovered, follow-ups 0/2) |
| 2.2 | Listen on load, then click anywhere on the page (not the mic) | Question 1 is read aloud — either immediately on load or on that first click (Chrome blocks autoplay until a gesture). The AI tile shows the speaking animation while audio plays |
| 2.3 | Click **🔊 Replay question** | Question is read aloud again; speaking animation active during playback |
| 2.4 | Untick "🔊 Read questions aloud", click Replay | Replay still speaks (explicit ask overrides the toggle). Re-tick the toggle afterwards |

## 3. Voice answering — happy path (core test)

Answer all 7 questions by voice. Speak naturally for ~20–40 seconds per answer.
For at least one answer, mention something specific and incomplete (e.g. "we used
caching" without saying how) to invite a follow-up.

| # | Step | Expected |
|---|---|---|
| 3.1 | Click **🎤 Start answering** | Button turns red/pulsing "⏹ Stop & submit"; status shows "Listening…"; browser may prompt for mic permission → **Allow** |
| 3.2 | Speak your answer | Interim (italic) text appears live while speaking; finalized text accumulates in the read-only answer box; there is **no way to type or edit** the text (voice-only) |
| 3.3 | Click **⏹ Stop & submit** | Answer submits automatically; "Interviewer is thinking…" spinner; then the next question appears, is read aloud, and your Q/A pair moves into the transcript above |
| 3.4 | After each answer, check the decision panel | Skills detected (with evidence quoting your words), gaps, topic chips fill in, follow-ups counter updates, "Why this question" shows a rationale that references your answer |
| 3.5 | Watch for follow-ups across the interview | At least 2 questions carry the **Follow-up** badge, and their wording clearly builds on something you actually said |
| 3.6 | Count questions | Exactly 7 total; progress bar reaches 7/7 |
| 3.7 | Submit the 7th answer | "That was the last question — preparing your results…" then auto-redirect to the results page |

## 4. Voice edge cases

| # | Step | Expected |
|---|---|---|
| 4.1 | Start the mic, say nothing for ~10s | Recognition keeps the session alive (auto-restarts); a gentle "didn't catch anything" style status may appear; no crash |
| 4.2 | Start the mic, speak, then pause ~10s, then speak again | Both segments end up in the answer box (auto-restart preserved your words) |
| 4.3 | Record something, click **Clear & re-record**, record again | Box empties; new recording replaces the old one; status confirms the reset |
| 4.4 | Click **⏹ Stop & submit** with an empty box (no speech captured) | Friendly "nothing captured" message; nothing submits; interview intact |
| 4.5 | While the mic is listening, check TTS | The app never reads questions while you're recording (no self-transcription) |

## 5. Mid-interview resilience

| # | Step | Expected |
|---|---|---|
| 5.1 | Mid-interview (e.g. after Q3), refresh the page (F5) | Transcript, current question, progress, topic chips, and follow-up counter all restore; you can continue answering by voice |
| 5.2 | Open the same room URL in a second Chrome tab | Same state renders; continue from either tab (don't submit from both simultaneously) |
| 5.3 | After finishing an interview (§3.7), press Back to return to the room | Room redirects you to the results page (completed sessions can't be re-entered) |

## 6. Video mode (camera)

| # | Step | Expected |
|---|---|---|
| 6.1 | In the room, click **📷 Camera on** → Allow | Your mirrored self-view appears in the "You" tile; button flips to "📷 Camera off" |
| 6.2 | Answer a question by voice with the camera on | Voice flow unaffected; both tiles visible — feels like a call |
| 6.3 | Click **📷 Camera off** | Video stops (webcam LED goes off), placeholder returns |
| 6.4 | Turn the camera on, then navigate away (home) | Webcam LED turns off (tracks released on navigation) |
| 6.5 | In a fresh session, click **📷 Camera on** → **Block** | Tile shows "Camera unavailable — interview continues voice-only"; the interview still works fully |

## 7. Results page

| # | Step | Expected |
|---|---|---|
| 7.1 | Review the transcript after §3.7 | All 7 Q/A pairs, in order; interviewer left/accented, your answers right; follow-up questions carry the badge; your answers match what you actually said |
| 7.2 | Review the evaluation | Overall score /10, strengths and concerns lists, summary paragraph — all plausibly grounded in your answers (not generic filler) |
| 7.3 | Expand "Raw evaluation JSON" | Valid JSON with `strengths`, `concerns`, `overall_score`, `summary` |
| 7.4 | Reload the results URL later (new tab / after closing) | Same results render — the session is persisted |

## 8. Failure modes & unsupported browsers

| # | Step | Expected |
|---|---|---|
| 8.1 | New session in Chrome; when the mic permission prompt appears, click **Block** (or pre-block via the padlock icon) | Blocking banner: interview is voice-only, use Chrome/Edge, allow microphone, refresh. Mic/Send/Clear controls disabled; no way to proceed by typing |
| 8.2 | Open the **home page** in **Firefox or Safari** | An amber warning bar appears under the header on every page: voice-only, use Chrome or Edge on desktop |
| 8.2b | In that browser, open a room URL | Warning bar plus the room's blocking banner; controls disabled; page otherwise renders without errors |
| 8.3 | (Optional) Toggle airplane mode / kill network, submit an answer | Readable error banner; your transcript is preserved; **Send answer** retries successfully once back online |

## 9. Session history

| # | Step | Expected |
|---|---|---|
| 9.1 | Click **History** in the header | `/sessions/` lists your interviews, newest first: role, date/time, status badge, questions n/7, follow-ups n/2, duration (completed only), "you spoke N%", score /10 (completed only) |
| 9.2 | Click a role filter chip | List narrows to that role; "All roles" restores; active chip is highlighted |
| 9.3 | Click **View results** on a completed session | Full transcript + evaluation (replay) |
| 9.4 | Click **Resume** on an active session | Back in that room, state restored, can continue |
| 9.5 | Sanity-check the metrics on the interview you just did | Questions 7/7, follow-ups 2/2, duration plausible, talk ratio high (you spoke most of the words), score matches the results page |

## 10. Cross-cutting

| # | Step | Expected |
|---|---|---|
| 10.1 | Keep DevTools Console open through one full interview | No uncaught errors (Chrome may log a speech-autoplay warning before the first gesture — that's expected browser policy, not a bug) |
| 10.2 | Narrow the window to ~400px in the room | Tiles and decision panel stack vertically; everything remains usable |
| 10.3 | Full run on the **live** URL specifically | Everything above works over HTTPS on Render (mic and camera permission prompts only appear on secure origins) |

---

## Sign-off

| Area | Status | Notes |
|---|---|---|
| Job list & session start | | |
| Voice happy path (7 Q, 2 follow-ups) | | |
| TTS incl. first question | | |
| Voice edge cases | | |
| Refresh / resilience | | |
| Video mode | | |
| Results | | |
| Failure modes / other browsers | | |
| History & metrics | | |

Tested by: ____________  Date: ____________  Browser/OS: ____________
