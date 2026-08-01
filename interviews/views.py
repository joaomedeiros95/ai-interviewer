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
    return render(request, "interviews/results.html", {"session": session})
