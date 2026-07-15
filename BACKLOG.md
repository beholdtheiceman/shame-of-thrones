# shame-of-thrones — Backlog

Out-of-scope problems get logged here instead of fixed inline. Add evidence and a rough effort.

## Health-gate follow-ups (from the ADW check-command rollout, 2026-07-15)

- [ ] **Strengthen the gate beyond `test` + `build:web`** (S–M) — `check` currently runs workspace
  tests and builds `apps/web` only. Add per-workspace typecheck/lint and build the other apps
  (e.g. the mobile target implied by the `feat/phase5-ship-mobile` branch), then fold them into
  the `check` script so the gate covers the whole monorepo.
