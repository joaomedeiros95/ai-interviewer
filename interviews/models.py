import uuid

from django.db import models


class Job(models.Model):
    title = models.CharField(max_length=200)
    description = models.TextField()
    # {"topics": [{"id", "category": "behavioral"|"technical", "question", "signals": [str]}]}
    question_pack = models.JSONField(default=dict)

    def __str__(self):
        return self.title


class InterviewSession(models.Model):
    STATUS_CHOICES = [("active", "Active"), ("completed", "Completed")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    job = models.ForeignKey(Job, on_delete=models.CASCADE, related_name="sessions")
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="active")
    # {topic_cursor, followups_used, questions_asked, signals, gaps, covered_topic_ids}
    state = models.JSONField(default=dict)
    evaluation = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"{self.job.title} — {self.id}"


class Turn(models.Model):
    ROLE_CHOICES = [("interviewer", "Interviewer"), ("candidate", "Candidate")]

    session = models.ForeignKey(
        InterviewSession, on_delete=models.CASCADE, related_name="turns"
    )
    index = models.PositiveIntegerField()
    role = models.CharField(max_length=16, choices=ROLE_CHOICES)
    text = models.TextField()
    # interviewer turns: {kind: "primary"|"followup", topic_id, rationale}
    meta = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["index"]
        constraints = [
            models.UniqueConstraint(
                fields=["session", "index"], name="unique_turn_index_per_session"
            )
        ]

    def __str__(self):
        return f"[{self.index}] {self.role}"
