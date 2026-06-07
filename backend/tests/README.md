# `tests` — backend test suite

`pytest` tests covering the deterministic, safety-critical pieces of the backend.
These modules are pure functions with no network or SSH dependencies, so the suite
runs fast and offline.

| File | Covers |
|---|---|
| `test_safety.py` | `app/ssh/safety.classify_command` — hard-block list and risk classification. |
| `test_redactor.py` | `app/ssh/redactor` — secret masking in text and dicts. |
| `test_activity_generator.py` | Activity-draft generation. |

`__init__.py` makes the folder a package.

---

## Running

Config lives in `pyproject.toml` (`asyncio_mode = "auto"`, `testpaths = ["tests"]`).
Set `PYTHONPATH=.` so tests import the local `app` package (the dev environment's
`PYTHONPATH` may otherwise point elsewhere):

```bash
cd backend
PYTHONPATH=. uv run pytest                       # whole suite
PYTHONPATH=. uv run pytest tests/test_safety.py  # single file
PYTHONPATH=. uv run pytest -k "blocked"          # filter by name
```

Each test file also inserts the backend root onto `sys.path` at import time, so
running them individually works too.

## What to keep covered

`test_safety.py` is the most important: it pins the exact set of commands that
**must be blocked** (e.g. `rm -rf /`, `chmod -R 777 /var`, `cat /etc/shadow`,
shell-wrapped bypasses like `bash -c "rm -rf /"`) and the expected `RiskLevel` for
allowed commands. When you change a pattern in `app/ssh/safety.py`, extend these
tables in the same change — the classifier is a load-bearing safety control, not a
heuristic.
