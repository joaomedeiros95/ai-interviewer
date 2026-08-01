import json

from django.shortcuts import get_object_or_404, render

from .models import InterviewSession, Job


def job_list(request):
    jobs = Job.objects.all()
    return render(request, "interviews/job_list.html", {"jobs": jobs})


def interview_room(request, session_id):
    session = get_object_or_404(InterviewSession, pk=session_id)
    return render(request, "interviews/room.html", {"session": session})


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
