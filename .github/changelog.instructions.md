---
applyTo: CHANGELOG.md
---

# Changelog maintenance instructions

## File location
`CHANGELOG.md` lives at the **monorepo root** (`/`).

## Version alignment rule
`@eetr/agent-streemr`, `@eetr/agent-streemr-react`, and `AgentStreemrSwift` always share the
same version number. Never write a changelog entry for one library at a version different from
the others.

## Format
Follow [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) conventions:

- Top-level headings: `## [<version>] – <date|unreleased>`
- Second-level headings group entries by library name exactly as written in the file header:
  `### @eetr/agent-streemr`, `### @eetr/agent-streemr-react`, `### AgentStreemrSwift`
- Third-level headings are the standard change categories:
  `#### Added`, `#### Changed`, `#### Fixed`, `#### Removed`, `#### Security`
- Each entry is a single bullet (`-`) written in **past tense**, starting with the affected
  symbol / file in backticks where applicable.
- Omit a library section entirely if it has no changes for that release.

## When to update the changelog

Update the changelog whenever:
- A new feature, behaviour change, or bug fix is implemented in any of the three libraries.
- A type is added, renamed, or removed from the public API.
- A breaking change is made (always note it explicitly with **Breaking:** prefix on the bullet).
- A security issue is resolved.

Do **not** add entries for:
- Internal refactors or renames that don't affect the public API or observable behaviour.
- Tooling / build / CI changes.
- Changes to the sample app (`agent-streemr-sample`).
- Documentation-only changes.

## Unreleased section

Always keep an `## [<next-version>] – unreleased` section at the top of the file.  
Accumulate all in-progress changes there.  
When a release is made, replace `unreleased` with the ISO date (e.g. `2026-03-13`).

## What to write

- Be specific: name the type, option, method, event, or hook that changed.
- One bullet per logical change. Don't bundle unrelated things into one bullet.
- For **Added**: describe what was added and its purpose in one sentence.
- For **Removed**: state what was removed and briefly why (e.g. "superseded by X").
- For **Fixed**: describe the bug symptom, not the internal cause.
- For **Changed**: describe the before → after behaviour.
