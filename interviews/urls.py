from django.urls import path

from . import api, views

urlpatterns = [
    path("", views.job_list, name="job_list"),
    path("interview/<uuid:session_id>/", views.interview_room, name="interview_room"),
    path("results/<uuid:session_id>/", views.results, name="results"),
    path("api/jobs/<int:job_id>/sessions/", api.create_session, name="api_create_session"),
    path("api/sessions/<uuid:session_id>/answers/", api.submit_answer, name="api_submit_answer"),
    path("api/sessions/<uuid:session_id>/", api.session_detail, name="api_session_detail"),
]
