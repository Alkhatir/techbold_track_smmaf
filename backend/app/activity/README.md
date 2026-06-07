# `app/activity` — activity draft helper

A thin convenience wrapper around the agent's activity generation. An **activity**
is the structured work log posted back to the Phoenix ERP when a ticket is
resolved (summary, root cause, actions taken, commands summary, validation
result).

| File | Role |
|---|---|
| `generator.py` | `ActivityGenerator` — delegates to `SupervisorAgent.generate_activity`. |

---

## `ActivityGenerator`

```python
ActivityGenerator(supervisor).generate(session) -> ActivityDraft
```

It simply forwards to `SupervisorAgent.generate_activity(session)` (see
`app/agent`). The real work — prompting Claude with the audit summary, command
results, and validation output, then producing a schema-validated
`ActivityDraft` — happens in the supervisor.

> Note: the live endpoint `POST /api/sessions/{id}/generate-activity`
> (`api/routes_agent.py`) currently calls `SupervisorAgent.generate_activity`
> directly. `ActivityGenerator` exists as a small seam for composing or swapping
> activity-drafting behaviour without the routes depending on the supervisor's
> exact shape.

The resulting `ActivityDraft` (`app/models.py`) is later mapped to an
`ActivityCreate` and submitted to the ERP by `POST /sessions/{id}/submit-activity`.
