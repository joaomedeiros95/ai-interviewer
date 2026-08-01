"""Seed the three demo jobs with their 5-topic question packs (idempotent)."""

from django.core.management.base import BaseCommand

from interviews.models import Job

JOBS = [
    {
        "title": "Backend Engineer",
        "description": (
            "We are hiring a Backend Engineer to design and operate the APIs "
            "and data pipelines behind our product. You will own services "
            "end-to-end — schema design, scaling, observability, and safe "
            "deployment — in a small team that ships to production daily."
        ),
        "question_pack": {
            "topics": [
                {
                    "id": 1,
                    "category": "behavioral",
                    "question": (
                        "To start: tell me about a recent backend system you "
                        "built and are proud of as a {job_title} — what did it "
                        "do, and what was your role in it?"
                    ),
                    "signals": ["ownership", "system scope", "impact"],
                },
                {
                    "id": 2,
                    "category": "technical",
                    "question": (
                        "Walk me through how you would design an API that has "
                        "to survive a sudden 10x traffic spike — where does it "
                        "break first, and what would you do about it?"
                    ),
                    "signals": [
                        "scalability",
                        "caching",
                        "bottleneck analysis",
                        "trade-off reasoning",
                    ],
                },
                {
                    "id": 3,
                    "category": "technical",
                    "question": (
                        "Describe a production incident you personally debugged "
                        "in a distributed system. How did you narrow down the "
                        "root cause?"
                    ),
                    "signals": [
                        "debugging methodology",
                        "observability",
                        "incident response",
                    ],
                },
                {
                    "id": 4,
                    "category": "behavioral",
                    "question": (
                        "Tell me about a time you disagreed with a teammate "
                        "over a technical decision — architecture, data "
                        "modeling, anything. How was it resolved?"
                    ),
                    "signals": ["collaboration", "communication", "pragmatism"],
                },
                {
                    "id": 5,
                    "category": "technical",
                    "question": (
                        "How do you approach testing and safe deployment for a "
                        "service that other teams depend on?"
                    ),
                    "signals": [
                        "testing strategy",
                        "CI/CD",
                        "risk management",
                        "backwards compatibility",
                    ],
                },
            ]
        },
    },
    {
        "title": "Frontend Engineer",
        "description": (
            "We are hiring a Frontend Engineer to build the interfaces our "
            "customers spend their day in. You will own features from design "
            "hand-off to production — component architecture, performance, "
            "and accessibility — working closely with design and product."
        ),
        "question_pack": {
            "topics": [
                {
                    "id": 1,
                    "category": "behavioral",
                    "question": (
                        "To start: tell me about a user-facing feature you "
                        "recently shipped as a {job_title} that you're proud "
                        "of — what made it challenging?"
                    ),
                    "signals": ["ownership", "user empathy", "impact"],
                },
                {
                    "id": 2,
                    "category": "technical",
                    "question": (
                        "Imagine a key page in your app takes four seconds to "
                        "become interactive. Walk me through how you would "
                        "diagnose and fix it."
                    ),
                    "signals": [
                        "performance profiling",
                        "bundle optimization",
                        "rendering behavior",
                        "web vitals",
                    ],
                },
                {
                    "id": 3,
                    "category": "technical",
                    "question": (
                        "How do you decide where state should live in a "
                        "complex app, and what have you done to keep a growing "
                        "frontend codebase maintainable?"
                    ),
                    "signals": [
                        "state management",
                        "component architecture",
                        "maintainability",
                    ],
                },
                {
                    "id": 4,
                    "category": "behavioral",
                    "question": (
                        "Tell me about a time you pushed back on a design or "
                        "product spec. What happened, and how did it land with "
                        "the designer or PM?"
                    ),
                    "signals": ["collaboration", "communication", "product sense"],
                },
                {
                    "id": 5,
                    "category": "technical",
                    "question": (
                        "How do you make sure what you ship is accessible and "
                        "stays that way — what does your testing setup look "
                        "like in practice?"
                    ),
                    "signals": [
                        "accessibility",
                        "testing strategy",
                        "quality mindset",
                    ],
                },
            ]
        },
    },
    {
        "title": "Product Manager",
        "description": (
            "We are hiring a Product Manager to own discovery, prioritization, "
            "and delivery for a core product area. You will turn ambiguous "
            "customer problems into a clear roadmap, work daily with "
            "engineering and design, and be accountable for outcomes, not "
            "output."
        ),
        "question_pack": {
            "topics": [
                {
                    "id": 1,
                    "category": "behavioral",
                    "question": (
                        "To start: tell me about a product or feature you "
                        "shipped recently as a {job_title} that you're proud "
                        "of — what problem did it solve, and how did you know "
                        "it worked?"
                    ),
                    "signals": [
                        "outcome orientation",
                        "problem framing",
                        "impact",
                    ],
                },
                {
                    "id": 2,
                    "category": "behavioral",
                    "question": (
                        "Tell me about a time you had to say no to an "
                        "important stakeholder. How did you decide, and how "
                        "did you communicate it?"
                    ),
                    "signals": [
                        "prioritization",
                        "stakeholder management",
                        "communication",
                    ],
                },
                {
                    "id": 3,
                    "category": "technical",
                    "question": (
                        "Suppose your activation rate drops 15% week over "
                        "week. Walk me through how you would investigate and "
                        "decide what to do."
                    ),
                    "signals": [
                        "analytical rigor",
                        "metrics fluency",
                        "root-cause thinking",
                    ],
                },
                {
                    "id": 4,
                    "category": "behavioral",
                    "question": (
                        "Describe a product bet you made that failed. What did "
                        "you learn, and what did you change afterward?"
                    ),
                    "signals": ["accountability", "learning mindset", "iteration"],
                },
                {
                    "id": 5,
                    "category": "technical",
                    "question": (
                        "How do you decide what to build next when user "
                        "requests, usage data, and company strategy all point "
                        "in different directions?"
                    ),
                    "signals": [
                        "strategic thinking",
                        "discovery process",
                        "judgment",
                    ],
                },
            ]
        },
    },
]


class Command(BaseCommand):
    help = "Seed the three demo jobs with question packs. Idempotent."

    def handle(self, *args, **options):
        for spec in JOBS:
            job, created = Job.objects.get_or_create(
                title=spec["title"],
                defaults={
                    "description": spec["description"],
                    "question_pack": spec["question_pack"],
                },
            )
            label = "Created" if created else "Already exists"
            self.stdout.write(self.style.SUCCESS(f"{label}: {job.title}"))
