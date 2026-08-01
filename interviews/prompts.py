"""Prompt builders for the interview engine's two structured LLM calls.

Each builder returns a ``messages`` list ready for
``client.chat.completions.parse``. The engine owns all decision logic; the
prompts only ask the model for analysis and candidate question phrasings.
"""


def _format_transcript(turns):
    """Render the conversation so far as labeled Q/A lines."""
    lines = []
    for turn in turns:
        if turn.role == "interviewer":
            kind = (turn.meta or {}).get("kind", "primary")
            lines.append(f"Interviewer ({kind} question): {turn.text}")
        else:
            lines.append(f"Candidate: {turn.text}")
    return "\n".join(lines)


def _format_topic(topic):
    if topic is None:
        return "(none — the current topic is the last one in the pack)"
    signals = ", ".join(topic.get("signals", []))
    return (
        f"[topic {topic['id']} / {topic['category']}] {topic['question']}\n"
        f"  Target signals: {signals}"
    )


def build_turn_analysis_messages(
    *, job, turns, current_topic, next_topic, followups_used, questions_asked
):
    """Prompt for the per-answer TurnAnalysis structured call."""
    system = (
        "You are an expert interviewer conducting a live, spoken screening "
        f"interview for a {job.title} role. After each candidate answer you "
        "analyze it and prepare what to ask next. You always respond with the "
        "requested structured output. Keep every question you write "
        "conversational, open-ended, and short enough to say out loud in one "
        "breath."
    )

    user = f"""ROLE BEING HIRED
Title: {job.title}
Description: {job.description}

CONVERSATION SO FAR (most recent candidate answer is last)
{_format_transcript(turns)}

CURRENT TOPIC (the question the candidate just answered relates to this)
{_format_topic(current_topic)}

NEXT PLANNED TOPIC FROM THE QUESTION PACK
{_format_topic(next_topic)}

INTERVIEW PROGRESS
- Questions asked so far: {questions_asked} of 7 total
- Follow-ups used so far: {followups_used} of 2 allowed

YOUR TASKS
1. signals_detected: from the candidate's LAST answer only, detect any of the
   current topic's target signals (or other clearly demonstrated skills). For
   each, give a short evidence quote or close paraphrase taken from that
   answer. Do not invent evidence; an empty list is fine.
2. gaps: list concrete things the role needs that the answer failed to show or
   left vague (e.g. "no mention of how success was measured"). Empty if none.
3. followup_warranted: true if the last answer was vague, incomplete, or
   touched something interesting worth probing deeper; false if it was
   thorough and the interview should move on.
4. followup_question: ALWAYS provide one, whether or not a follow-up is
   warranted. It must dig into something specific the candidate actually said
   in their last answer — reference their own words.
5. next_primary_question: ALWAYS provide one, whether or not a follow-up is
   warranted. It must be a natural, conversational phrasing of the NEXT
   planned topic above, adapted to this role and — when it fits — briefly
   bridging from something in the conversation so far. Preserve the topic's
   intent; do not substitute a different topic. If there is no next topic,
   phrase a deeper question on the current topic instead.
6. rationale: one sentence explaining your followup_warranted judgment, e.g.
   what was vague, interesting, or complete about the answer.
"""
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


def build_evaluation_messages(*, job, turns, signals, gaps):
    """Prompt for the end-of-interview Evaluation structured call."""
    system = (
        "You are an experienced hiring evaluator writing an honest, specific "
        "screening assessment of an interview transcript. You ground every "
        "claim in what the candidate actually said, and you do not inflate "
        "scores. You always respond with the requested structured output."
    )

    signal_lines = (
        "\n".join(f"- {s.get('skill', '?')}: {s.get('evidence', '')}" for s in signals)
        or "(none recorded)"
    )
    gap_lines = "\n".join(f"- {g}" for g in gaps) or "(none recorded)"

    user = f"""ROLE BEING HIRED
Title: {job.title}
Description: {job.description}

FULL INTERVIEW TRANSCRIPT
{_format_transcript(turns)}

SIGNALS ACCUMULATED DURING THE INTERVIEW
{signal_lines}

GAPS ACCUMULATED DURING THE INTERVIEW
{gap_lines}

YOUR TASK
Write the final evaluation for this candidate against this role:
- strengths: specific strengths demonstrated in the transcript, each tied to
  something the candidate said. No generic filler.
- concerns: specific gaps, risks, or weak answers relevant to the role. Be
  honest — an empty list should be rare.
- overall_score: an integer from 1 (poor) to 10 (exceptional). Calibrate:
  5-6 is an average screen, 7-8 is a clear advance, 9-10 is rare.
- summary: 2-4 sentences a hiring manager could read to decide whether to
  advance the candidate. Specific, balanced, and grounded in the transcript.
"""
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
