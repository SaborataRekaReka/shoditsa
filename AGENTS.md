# Instructions for repository agents

When the user asks to add, integrate, launch, or deploy a new game based on guessing an entity by comparable attributes, read and execute [docs/GAME_MODE_INTEGRATION_RUNBOOK.md](docs/GAME_MODE_INTEGRATION_RUNBOOK.md) before editing code.

Treat its data, release-content, active-revision, browser UX, and production Definition of Done gates as blocking. A new mode is not complete merely because it builds locally or its route renders. Do not use the web-only "scripts/deploy/timeweb.ps1" as the release path for a new mode.
