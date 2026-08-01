"""OpenAI structured-output wrapper for the interview engine.

Both public functions RAISE on any error (missing key, network, timeout,
refusal, schema validation). The engine owns the fallback behavior.
"""

from django.conf import settings
from openai import OpenAI
from pydantic import BaseModel, Field

from . import prompts

REQUEST_TIMEOUT_SECONDS = 30.0


class SignalDetection(BaseModel):
    skill: str = Field(description="The skill or signal demonstrated.")
    evidence: str = Field(
        description="Short quote or close paraphrase from the candidate's last answer."
    )


class TurnAnalysis(BaseModel):
    signals_detected: list[SignalDetection]
    gaps: list[str]
    followup_warranted: bool
    followup_question: str
    next_primary_question: str
    rationale: str


class Evaluation(BaseModel):
    strengths: list[str]
    concerns: list[str]
    overall_score: int = Field(
        description="Integer from 1 (poor) to 10 (exceptional)."
    )
    summary: str


def _client():
    if not settings.OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY is not configured")
    return OpenAI(api_key=settings.OPENAI_API_KEY, timeout=REQUEST_TIMEOUT_SECONDS)


def _parse(messages, schema):
    completion = _client().chat.completions.parse(
        model=settings.OPENAI_MODEL,
        messages=messages,
        response_format=schema,
    )
    parsed = completion.choices[0].message.parsed
    if parsed is None:
        raise RuntimeError("model returned no parsed output (refusal or empty message)")
    return parsed


def analyze_turn(
    *, job, turns, current_topic, next_topic, followups_used, questions_asked
) -> TurnAnalysis:
    """One structured call after each candidate answer. Raises on any error."""
    messages = prompts.build_turn_analysis_messages(
        job=job,
        turns=turns,
        current_topic=current_topic,
        next_topic=next_topic,
        followups_used=followups_used,
        questions_asked=questions_asked,
    )
    return _parse(messages, TurnAnalysis)


def evaluate_interview(*, job, turns, signals, gaps) -> Evaluation:
    """End-of-interview structured evaluation call. Raises on any error."""
    messages = prompts.build_evaluation_messages(
        job=job, turns=turns, signals=signals, gaps=gaps
    )
    return _parse(messages, Evaluation)
