# EnergyDeck working agreements

## Keep the ESP display and web app in sync

- Treat requests to change the ESP display as requests to update the corresponding web app functionality in the same task, unless the user explicitly limits the scope.
- Keep shared features, data interpretation, units, translations, status indicators and control behavior consistent across the ESP and web app. Adapt layouts and interactions to each screen size.
- For hardware-only changes with no web equivalent, check the web impact and explain briefly why no web change is needed.
- Verify both affected implementations with appropriate checks: build the display simulator for ESP UI changes and run the relevant web checks for web changes. Update shared setup and feature documentation as needed.

## Finish each change with a commit

- After every user task that changes this repository, complete appropriate checks and create a local Git commit without requesting another confirmation. Follow an explicit user instruction to postpone or skip a commit.
- Read-only questions and reviews do not need an empty commit.
- Before staging, inspect the working tree. Preserve unrelated work and never discard it. Include existing changes when the user explicitly asks to commit everything.
- Stage specific relevant paths. Never commit credentials, .env files, local secrets, generated firmware, build directories, or Python caches.
- Use a descriptive English commit subject and, for substantial changes, a body explaining what changed, why, and how it was verified. Do not claim tests or hardware checks that were not performed.
- End the response with the commit hash and a short description of the result and verification. Push only when the user asks.

## Clear explanations and comments

- Communicate with the user in Dutch. Keep code and documentation in English, and keep UI text in the English/Dutch translation files.
- Add concise comments for non-obvious logic, timing, units, sign conventions, API assumptions, and workarounds. Explain the reason rather than restating the code.
- Update relevant documentation when behavior or setup changes.
- Verify UI changes with a simulator build; use visual inspection when available. Keep simulator work separate from flashing the physical display, which requires a user request.
- Do not trigger real charging Flows merely to test presentation changes. Use read-only data checks where possible.
