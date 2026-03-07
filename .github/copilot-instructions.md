# Copilot Instructions

## Protocol is frozen — do not touch without explicit approval

The files under `agent-streemr/src/protocol/` (`events.ts`, `stream.ts`) and
`agent-streemr/src/server/adapter.ts` define the **public wire protocol** of
this library.  These files must **never** be modified unless the user explicitly
says so.  This applies to:

- Adding, removing, or renaming event types or payload fields.
- Changing `ServerToClientEvents` / `ClientToServerEvents` interfaces.
- Adding new variants to `AgentStreamEvent`.
- Any changes to the adapter's `run()` switch statement.

When a feature seems to require a protocol change, **discuss it first** and wait
for explicit approval before touching those files.
