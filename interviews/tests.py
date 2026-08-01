"""Engine + API tests with a stubbed LLM (no network calls)."""

import io
import uuid
from unittest.mock import patch

from django.core.management import call_command
from django.test import TestCase

from . import engine
from .llm import Evaluation, SignalDetection, TurnAnalysis
from .models import InterviewSession, Job

ANALYZE = "interviews.llm.analyze_turn"
EVALUATE = "interviews.llm.evaluate_interview"


def stub_analysis(followup_warranted):
    return TurnAnalysis(
        signals_detected=[
            SignalDetection(skill="communication", evidence="clear, structured answer")
        ],
        gaps=["no mention of measurable impact"],
        followup_warranted=followup_warranted,
        followup_question="You mentioned a migration — what made it risky?",
        next_primary_question="Building on that, let's talk about the next topic.",
        rationale="stubbed rationale",
    )


STUB_EVALUATION = Evaluation(
    strengths=["clear communication"],
    concerns=["little detail on testing"],
    overall_score=7,
    summary="Solid screen; advance with a deeper technical round.",
)


class InterviewFlowTests(TestCase):
    """Full interview flows through the real HTTP API with llm.* stubbed."""

    def setUp(self):
        call_command("seed_jobs", stdout=io.StringIO())
        self.job = Job.objects.get(title="Backend Engineer")

    # -- helpers ---------------------------------------------------------

    def _create_session(self):
        response = self.client.post(f"/api/jobs/{self.job.id}/sessions/")
        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.assertFalse(data["done"])
        self.assertEqual(data["question"]["index"], 0)
        self.assertEqual(
            data["question"]["meta"],
            {
                "kind": "primary",
                "topic_id": 1,
                "rationale": "opening question from pack",
            },
        )
        self.assertIn(self.job.title, data["question"]["text"])
        return data["session_id"]

    def _answer(self, session_id, text="I led the project and shipped it."):
        return self.client.post(
            f"/api/sessions/{session_id}/answers/",
            {"text": text},
            content_type="application/json",
        )

    def _run_full_interview(self, session_id):
        """Post answers until done=True; returns the list of responses."""
        responses = []
        for i in range(engine.TOTAL_QUESTIONS):
            response = self._answer(session_id, f"Answer number {i + 1}.")
            self.assertEqual(response.status_code, 200)
            data = response.json()
            responses.append(data)
            if i < engine.TOTAL_QUESTIONS - 1:
                self.assertFalse(data["done"])
                self.assertIsNotNone(data["question"])
                self.assertIsNone(data["evaluation"])
        self.assertTrue(responses[-1]["done"])
        self.assertIsNone(responses[-1]["question"])
        return responses

    def _interviewer_kinds(self, session_id):
        session = InterviewSession.objects.get(pk=session_id)
        return [
            t.meta["kind"]
            for t in session.turns.filter(role="interviewer").order_by("index")
        ]

    # -- (a) happy path, follow-ups forced by policy ---------------------

    def test_no_warranted_followups_still_seven_questions_two_followups(self):
        with (
            patch(ANALYZE, return_value=stub_analysis(False)) as mock_analyze,
            patch(EVALUATE, return_value=STUB_EVALUATION),
        ):
            session_id = self._create_session()
            responses = self._run_full_interview(session_id)

        kinds = self._interviewer_kinds(session_id)
        self.assertEqual(len(kinds), 7)
        self.assertEqual(kinds.count("primary"), 5)
        self.assertEqual(kinds.count("followup"), 2)
        # The 2 follow-ups are forced only once questions_asked >= 5.
        self.assertEqual(kinds, ["primary"] * 5 + ["followup"] * 2)
        # 6 analysis calls (answers 1-6); the 7th answer triggers evaluation.
        self.assertEqual(mock_analyze.call_count, 6)

        session = InterviewSession.objects.get(pk=session_id)
        self.assertEqual(session.status, "completed")
        self.assertIsNotNone(session.completed_at)
        self.assertEqual(session.state["questions_asked"], 7)
        self.assertEqual(session.state["followups_used"], 2)
        self.assertEqual(session.state["covered_topic_ids"], [1, 2, 3, 4, 5])
        self.assertEqual(session.evaluation, STUB_EVALUATION.model_dump())

        final = responses[-1]
        self.assertEqual(final["evaluation"], STUB_EVALUATION.model_dump())
        panel = final["decision_panel"]
        self.assertEqual(panel["covered_topics"], [1, 2, 3, 4, 5])
        self.assertEqual(panel["followups_used"], 2)
        self.assertEqual(panel["rationale"], "interview complete")
        self.assertTrue(panel["signals"])
        self.assertTrue(panel["gaps"])

        # Mid-interview decision_panel shape (first answer response).
        mid_panel = responses[0]["decision_panel"]
        self.assertEqual(
            mid_panel["signals"],
            [{"skill": "communication", "evidence": "clear, structured answer"}],
        )
        self.assertEqual(mid_panel["gaps"], ["no mention of measurable impact"])

        # Answering a completed session -> 409.
        response = self._answer(session_id)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json(), {"error": "session already completed"})

        # Session detail reflects the finished interview.
        detail = self.client.get(f"/api/sessions/{session_id}/").json()
        self.assertEqual(detail["status"], "completed")
        self.assertEqual(detail["job"]["title"], "Backend Engineer")
        self.assertEqual(len(detail["turns"]), 14)  # 7 questions + 7 answers
        self.assertEqual(detail["evaluation"], STUB_EVALUATION.model_dump())

    # -- (b) follow-ups capped at 2 --------------------------------------

    def test_always_warranted_followups_capped_at_two(self):
        with (
            patch(ANALYZE, return_value=stub_analysis(True)),
            patch(EVALUATE, return_value=STUB_EVALUATION),
        ):
            session_id = self._create_session()
            self._run_full_interview(session_id)

        kinds = self._interviewer_kinds(session_id)
        self.assertEqual(len(kinds), 7)
        self.assertEqual(kinds.count("primary"), 5)
        self.assertEqual(kinds.count("followup"), 2)
        # Both follow-up slots are consumed immediately, then primaries only.
        self.assertEqual(kinds, ["primary", "followup", "followup"] + ["primary"] * 4)

        session = InterviewSession.objects.get(pk=session_id)
        self.assertEqual(session.status, "completed")
        self.assertEqual(session.state["covered_topic_ids"], [1, 2, 3, 4, 5])

    # -- (c) LLM down -> fallback completes the interview ----------------

    def test_llm_failure_completes_interview_via_fallback(self):
        with (
            patch(ANALYZE, side_effect=RuntimeError("LLM down")),
            patch(EVALUATE, side_effect=RuntimeError("LLM down")),
        ):
            session_id = self._create_session()
            responses = self._run_full_interview(session_id)

        session = InterviewSession.objects.get(pk=session_id)
        interviewer_turns = list(
            session.turns.filter(role="interviewer").order_by("index")
        )
        self.assertEqual(len(interviewer_turns), 7)
        kinds = [t.meta["kind"] for t in interviewer_turns]
        self.assertEqual(kinds, ["primary"] * 5 + ["followup"] * 2)

        # Every generated question after Q1 used the fallback path.
        for turn in interviewer_turns[1:]:
            self.assertEqual(turn.meta["rationale"], "fallback")
        # Fallback primaries serve the pack questions verbatim, in order.
        pack = self.job.question_pack["topics"]
        for turn, topic in zip(interviewer_turns[1:5], pack[1:5]):
            self.assertEqual(turn.text, topic["question"])
            self.assertEqual(turn.meta["topic_id"], topic["id"])

        self.assertEqual(session.status, "completed")
        self.assertEqual(session.evaluation, engine.FALLBACK_EVALUATION)
        self.assertEqual(responses[-1]["evaluation"], engine.FALLBACK_EVALUATION)
        self.assertEqual(session.state["signals"], [])
        self.assertEqual(session.state["gaps"], [])
        self.assertEqual(session.state["covered_topic_ids"], [1, 2, 3, 4, 5])

    # -- error cases -----------------------------------------------------

    def test_error_responses(self):
        # 404: unknown job / unknown session.
        self.assertEqual(self.client.post("/api/jobs/9999/sessions/").status_code, 404)
        missing = uuid.uuid4()
        self.assertEqual(
            self._answer(missing).status_code, 404
        )
        self.assertEqual(self.client.get(f"/api/sessions/{missing}/").status_code, 404)

        with patch(ANALYZE, return_value=stub_analysis(False)):
            session_id = self._create_session()

            # 400: missing / blank / invalid-JSON text.
            for body in ({}, {"text": "   "}, {"text": 42}):
                response = self.client.post(
                    f"/api/sessions/{session_id}/answers/",
                    body,
                    content_type="application/json",
                )
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json(), {"error": "text is required"})
            response = self.client.post(
                f"/api/sessions/{session_id}/answers/",
                "not json",
                content_type="application/json",
            )
            self.assertEqual(response.status_code, 400)

        # seed_jobs is idempotent.
        call_command("seed_jobs", stdout=io.StringIO())
        call_command("seed_jobs", stdout=io.StringIO())
        self.assertEqual(Job.objects.count(), 3)
