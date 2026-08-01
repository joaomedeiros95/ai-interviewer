# AI Interviewer Platform

Your task is to build a lightweight web application where users can select a job and complete an AI-driven interview. The interview starts voice-only: the candidate talks to the screen, and the AI asks dynamic questions that change based on what the user says.

## Technical Specifications

### Requirements

- Users can view a list of sample jobs (at least 3), each with a title + short description.
- When a user clicks a job, they enter an Interview Room for that role.
- Users can talk via microphone (voice input) and see the AI interviewer's questions.
- The AI interviewer must ask at least 6 questions, including at least 2 follow-ups that depend on the user's prior answer.
- The interview must be role-grounded (questions reflect the selected job).
- The app must save the session and display, at the end:
  - full transcript (Q/A turns)
  - a simple structured evaluation (JSON is fine: strengths, concerns, overall score)
- Clean, functional UI with minimal friction.
- Must work end-to-end in a hosted environment.

All project code must be housed in a single public GitHub repository. The code must be deployed on a publicly viewable website (share password if using one). You may use any coding assistant tool and any resource online. This is an individual exercise.

## Stretch Goals (implement in order)

1. **Deterministic interviewer state**: Show a "decision panel" that displays the interviewer's current rubric/signals (skills detected, topics covered, gaps) and why it chose the next question.
2. **Job-specific question packs**: Add structured question banks per role (behavioral + technical categories), and have the AI select from them + generate targeted follow-ups.
3. **Video mode**: Add optional camera input and have the interview run in a "video call" layout (still voice-driven; video is just the interface/UX layer).
4. **Replay + analytics**: Add a session history page where users can replay interviews, filter by role, and see per-session metrics (duration, talk ratio, topic coverage, score trend).
