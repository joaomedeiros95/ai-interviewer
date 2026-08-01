from django.http import JsonResponse
from django.views.decorators.http import require_GET, require_POST


@require_POST
def create_session(request, job_id):
    return JsonResponse({"error": "not implemented"}, status=501)


@require_POST
def submit_answer(request, session_id):
    return JsonResponse({"error": "not implemented"}, status=501)


@require_GET
def session_detail(request, session_id):
    return JsonResponse({"error": "not implemented"}, status=501)
