from django.contrib import admin

from .models import InterviewSession, Job, Turn

admin.site.register(Job)
admin.site.register(InterviewSession)
admin.site.register(Turn)
