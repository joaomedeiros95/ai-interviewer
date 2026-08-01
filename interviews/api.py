"""JSON API endpoints (contract: CONTRACT.md).

Plain Django views. CSRF is enforced by the standard CsrfViewMiddleware; the
room page sends the token via the X-CSRFToken header.
"""

import json

from django.http import JsonResponse
from django.views.decorators.http import require_GET, require_POST

from . import engine
from .models import InterviewSession, Job


def _get_session(session_id):
    try:
        return InterviewSession.objects.select_related("job").get(pk=session_id)
    except InterviewSession.DoesNotExist:
        return None


@require_POST
def create_session(request, job_id):
    try:
        job = Job.objects.get(pk=job_id)
    except Job.DoesNotExist:
        return JsonResponse({"error": "job not found"}, status=404)

    session, first_turn = engine.start_session(job)
    return JsonResponse(
        {
            "session_id": str(session.id),
            "question": {
                "index": first_turn.index,
                "text": first_turn.text,
                "meta": first_turn.meta,
            },
            "done": False,
        },
        status=201,
    )


@require_POST
def submit_answer(request, session_id):
    session = _get_session(session_id)
    if session is None:
        return JsonResponse({"error": "session not found"}, status=404)
    if session.status == "completed":
        return JsonResponse({"error": "session already completed"}, status=409)

    try:
        payload = json.loads(request.body or b"")
    except (json.JSONDecodeError, UnicodeDecodeError):
        payload = None
    text = payload.get("text") if isinstance(payload, dict) else None
    if not isinstance(text, str) or not text.strip():
        return JsonResponse({"error": "text is required"}, status=400)

    try:
        result = engine.submit_answer(session, text.strip())
    except engine.SessionCompleted:
        return JsonResponse({"error": "session already completed"}, status=409)
    return JsonResponse(result)


@require_GET
def session_detail(request, session_id):
    session = _get_session(session_id)
    if session is None:
        return JsonResponse({"error": "session not found"}, status=404)

    return JsonResponse(
        {
            "session_id": str(session.id),
            "job": {
                "id": session.job.id,
                "title": session.job.title,
                "description": session.job.description,
            },
            "status": session.status,
            "turns": [
                {"index": t.index, "role": t.role, "text": t.text, "meta": t.meta}
                for t in session.turns.order_by("index")
            ],
            "evaluation": session.evaluation,
        }
    )
