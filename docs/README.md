# Documentation

Technical documentation for the AI Voice Interviewer. All diagrams are Mermaid
and render inline on GitHub.

| Doc | What it covers |
|---|---|
| [Database model](database-model.md) | ER diagram, constraints, the JSON field shapes that carry the engine state, row lifecycle, query notes |
| [Application flow](application-flow.md) | User journey, the full answer round trip, the decision rule, session state machine, browser voice path, failure handling |
| [Architecture](architecture.md) | System context, layer responsibilities, routing, deployment topology, security, concurrency, and what was deliberately left out |

Related: [CONTRACT.md](../CONTRACT.md) is the frozen API and data contract;
[E2E_TEST_PLAN.md](../E2E_TEST_PLAN.md) is the manual test plan;
[README.md](../README.md) is setup and deploy.
