"""Deterministic interview engine (policy per CONTRACT.md).

An interview is exactly 7 interviewer questions: 5 primaries (the pack's
topics, in order) and 2 follow-ups. After each candidate answer one structured
LLM call analyzes the turn; on any LLM failure the engine falls back to the
pack so the interview always completes.

Decision rule after each answer (while questions_asked < 7):
    follow-up  if followups_used < 2 AND (followup_warranted OR questions_asked >= 5)
    otherwise  next primary topic (advance topic_cursor)

The force clause (questions_asked >= 5) guarantees exactly 2 follow-ups even
when the model never asks for one.
"""

import logging

from django.db import transaction
from django.utils import timezone

from . import llm
from .models import InterviewSession, Turn

logger = logging.getLogger(__name__)

TOTAL_QUESTIONS = 7
MAX_FOLLOWUPS = 2
FORCE_FOLLOWUP_AT = 5

FALLBACK_RATIONALE = "fallback"
FALLBACK_FOLLOWUP_TEXT = (
    "Could you go deeper on your last answer — what was the most challenging "
    "part, and how did you work through it?"
)
FALLBACK_EVALUATION = {
    "strengths": [],
    "concerns": ["evaluation unavailable"],
    "overall_score": 0,
    "summary": "Evaluation failed",
}


class SessionCompleted(Exception):
    """Raised when an answer arrives for a session that is already completed."""


def _topics(job):
    return job.question_pack.get("topics", [])


def _template(text, job):
    """Render a pack question for a specific job (``{job_title}`` placeholder)."""
    return text.replace("{job_title}", job.title)


def _question_payload(turn):
    return {"index": turn.index, "text": turn.text, "meta": turn.meta}


def _decision_panel(state, rationale):
    return {
        "signals": state["signals"],
        "gaps": state["gaps"],
        "covered_topics": state["covered_topic_ids"],
        "followups_used": state["followups_used"],
        "rationale": rationale,
    }


def _merge_signals(state, detected):
    seen = {(s.get("skill"), s.get("evidence")) for s in state["signals"]}
    for signal in detected:
        item = {"skill": signal.skill, "evidence": signal.evidence}
        key = (item["skill"], item["evidence"])
        if key not in seen:
            state["signals"].append(item)
            seen.add(key)


def _merge_gaps(state, gaps):
    for gap in gaps:
        if gap not in state["gaps"]:
            state["gaps"].append(gap)


def start_session(job):
    """Create a session and its opening question (Turn 0). No LLM call."""
    first = _topics(job)[0]
    session = InterviewSession.objects.create(
        job=job,
        state={
            "topic_cursor": 0,
            "followups_used": 0,
            "questions_asked": 1,
            "signals": [],
            "gaps": [],
            "covered_topic_ids": [first["id"]],
        },
    )
    turn = Turn.objects.create(
        session=session,
        index=0,
        role="interviewer",
        text=_template(first["question"], job),
        meta={
            "kind": "primary",
            "topic_id": first["id"],
            "rationale": "opening question from pack",
        },
    )
    return session, turn


@transaction.atomic
def submit_answer(session, text):
    """Record a candidate answer and advance the interview one step.

    Returns the answers-endpoint response shape from CONTRACT.md.
    Raises SessionCompleted if the session is already completed.
    """
    session = InterviewSession.objects.select_for_update().select_related("job").get(
        pk=session.pk
    )
    if session.status == "completed":
        raise SessionCompleted()

    job = session.job
    state = dict(session.state)
    turns = list(session.turns.order_by("index"))
    next_index = turns[-1].index + 1 if turns else 0

    answer = Turn.objects.create(
        session=session, index=next_index, role="candidate", text=text, meta={}
    )
    turns.append(answer)

    if state["questions_asked"] >= TOTAL_QUESTIONS:
        # This answer closes question 7 — evaluate and complete.
        return _complete(session, state, turns)

    topics = _topics(job)
    cursor = state["topic_cursor"]
    current_topic = topics[cursor]
    next_topic = topics[cursor + 1] if cursor + 1 < len(topics) else None

    try:
        analysis = llm.analyze_turn(
            job=job,
            turns=turns,
            current_topic=current_topic,
            next_topic=next_topic,
            followups_used=state["followups_used"],
            questions_asked=state["questions_asked"],
        )
    except Exception as exc:
        logger.warning(
            "turn analysis LLM call failed for session %s (%s: %s); using pack fallback",
            session.pk,
            type(exc).__name__,
            exc,
        )
        analysis = None

    if analysis is not None:
        _merge_signals(state, analysis.signals_detected)
        _merge_gaps(state, analysis.gaps)

    followup_warranted = analysis.followup_warranted if analysis else False
    take_followup = state["followups_used"] < MAX_FOLLOWUPS and (
        followup_warranted or state["questions_asked"] >= FORCE_FOLLOWUP_AT
    )
    if next_topic is None:
        # No primaries left (only reachable with a malformed <5-topic pack;
        # with 5 topics the force clause already chooses a follow-up here).
        take_followup = True

    if take_followup:
        state["followups_used"] += 1
        kind = "followup"
        topic_id = current_topic["id"]
        if analysis is not None:
            question_text, rationale = analysis.followup_question, analysis.rationale
        else:
            question_text, rationale = FALLBACK_FOLLOWUP_TEXT, FALLBACK_RATIONALE
    else:
        state["topic_cursor"] = cursor + 1
        new_topic = topics[state["topic_cursor"]]
        kind = "primary"
        topic_id = new_topic["id"]
        if topic_id not in state["covered_topic_ids"]:
            state["covered_topic_ids"].append(topic_id)
        if analysis is not None:
            question_text = analysis.next_primary_question
            rationale = analysis.rationale
        else:
            question_text = _template(new_topic["question"], job)
            rationale = FALLBACK_RATIONALE

    state["questions_asked"] += 1
    question = Turn.objects.create(
        session=session,
        index=next_index + 1,
        role="interviewer",
        text=question_text,
        meta={"kind": kind, "topic_id": topic_id, "rationale": rationale},
    )
    session.state = state
    session.save(update_fields=["state"])

    return {
        "question": _question_payload(question),
        "done": False,
        "decision_panel": _decision_panel(state, rationale),
        "evaluation": None,
    }


def _complete(session, state, turns):
    try:
        evaluation = llm.evaluate_interview(
            job=session.job,
            turns=turns,
            signals=state["signals"],
            gaps=state["gaps"],
        ).model_dump()
    except Exception as exc:
        logger.warning(
            "evaluation LLM call failed for session %s (%s: %s); "
            "storing fallback evaluation",
            session.pk,
            type(exc).__name__,
            exc,
        )
        evaluation = dict(FALLBACK_EVALUATION)

    session.state = state
    session.evaluation = evaluation
    session.status = "completed"
    session.completed_at = timezone.now()
    session.save(update_fields=["state", "evaluation", "status", "completed_at"])

    return {
        "question": None,
        "done": True,
        "decision_panel": _decision_panel(state, "interview complete"),
        "evaluation": evaluation,
    }
