import json

from django.db.models import Count, Q
from django.shortcuts import get_object_or_404, render

from .models import InterviewSession, Job


def job_list(request):
    jobs = Job.objects.all()
    return render(request, "interviews/job_list.html", {"jobs": jobs})


def interview_room(request, session_id):
    session = get_object_or_404(InterviewSession, pk=session_id)
    return render(request, "interviews/room.html", {"session": session})


def _humanize_duration(delta):
    """Render a timedelta like '6m 32s' (or '1h 04m' past the hour mark)."""
    total_seconds = max(int(delta.total_seconds()), 0)
    minutes, seconds = divmod(total_seconds, 60)
    hours, minutes = divmod(minutes, 60)
    if hours:
        return f"{hours}h {minutes:02d}m"
    if minutes:
        return f"{minutes}m {seconds:02d}s"
    return f"{seconds}s"


def session_history(request):
    """Session history: list all interviews with per-session metrics.

    Query budget (constant, no per-row queries): 1 for jobs, 1 for sessions
    (with the interviewer-turn Count annotation), 1 for the turns prefetch.
    Word counts / talk ratio are computed in Python over the prefetched turns.
    """
    jobs = Job.objects.all()

    selected_job_id = None
    job_param = request.GET.get("job")
    if job_param:
        try:
            selected_job_id = int(job_param)
        except (TypeError, ValueError):
            selected_job_id = None

    sessions_qs = (
        InterviewSession.objects.select_related("job")
        .prefetch_related("turns")
        .annotate(
            interviewer_turns=Count("turns", filter=Q(turns__role="interviewer"))
        )
        .order_by("-created_at")
    )
    if selected_job_id is not None:
        sessions_qs = sessions_qs.filter(job_id=selected_job_id)

    sessions = []
    for session in sessions_qs:
        state = session.state if isinstance(session.state, dict) else {}
        evaluation = (
            session.evaluation if isinstance(session.evaluation, dict) else None
        )

        duration = None
        if session.status == "completed" and session.completed_at:
            duration = _humanize_duration(session.completed_at - session.created_at)

        candidate_words = 0
        total_words = 0
        for turn in session.turns.all():  # prefetched — no extra queries
            words = len(turn.text.split())
            total_words += words
            if turn.role == "candidate":
                candidate_words += words
        talk_ratio = (
            round(100 * candidate_words / total_words) if total_words else None
        )

        sessions.append(
            {
                "session": session,
                "questions_asked": session.interviewer_turns,
                "followups_used": state.get("followups_used") or 0,
                "duration": duration,
                "talk_ratio": talk_ratio,
                "overall_score": (
                    evaluation.get("overall_score") if evaluation else None
                ),
            }
        )

    context = {
        "sessions": sessions,
        "jobs": jobs,
        "selected_job_id": selected_job_id,
    }
    return render(request, "interviews/history.html", context)


def results(request, session_id):
    session = get_object_or_404(InterviewSession, pk=session_id)
    turns = list(session.turns.all())
    evaluation = session.evaluation if isinstance(session.evaluation, dict) else None
    context = {
        "session": session,
        "turns": turns,
        "evaluation": evaluation,
        "evaluation_json": (
            json.dumps(session.evaluation, indent=2, ensure_ascii=False)
            if session.evaluation is not None
            else None
        ),
    }
    return render(request, "interviews/results.html", context)
