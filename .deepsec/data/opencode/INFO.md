# opencode

## What this codebase does

OpenCode is an open-source AI coding agent shipped as a Bun/TypeScript
monorepo. `packages/opencode` is the local CLI/server core: Hono HTTP routes,
WebSocket PTY sessions, SSE event streams, file/project APIs, AI provider auth,
MCP integration, and permission-gated tools. Other packages provide the web,
desktop, SDK, enterprise share UI, Cloudflare Worker sync/share endpoints, and
Slack integration.

## Auth shape

- Local server auth is optional Basic auth in `Server.ControlPlaneRoutes`,
  controlled by `Flag.OPENCODE_SERVER_PASSWORD` and
  `Flag.OPENCODE_SERVER_USERNAME`; when unset, local APIs are intentionally
  open to allowed origins/workspace clients.
- Request schemas are usually enforced with Hono `validator()` plus zod/effect
  schemas; route handlers using raw `c.req.json()`, `c.req.param()`, or
  `c.req.query()` need extra scrutiny.
- Provider credentials live behind `Auth.Service`/`Auth.Info` and are written to
  `auth.json` with mode `0o600`; remote `.well-known/opencode` config can also
  inject provider env vars.
- Tool execution is guarded by `Permission.evaluate`, `Permission.ask`,
  `Permission.reply`, `Permission.fromConfig`, and per-tool permission keys
  such as `bash`, `edit`, `read`, `external_directory`, `webfetch`, and `mcp`.
- Filesystem boundaries rely on `Instance.containsPath` and
  `assertExternalDirectory`; paths inside either `Instance.directory` or git
  `Instance.worktree` are considered in-bounds.

## Threat model

Highest-impact bugs let a remote or browser-adjacent caller drive the local
OpenCode server to read/write files, run shell/PTY commands, approve tool
permissions, mutate provider credentials, or proxy work into another workspace.
Cloudflare/enterprise share bugs can expose private session content or allow
unauthorized sync/delete. Config/plugin/MCP loading is also sensitive because it
can introduce commands, env vars, provider credentials, and executable plugins.

## Project-specific patterns to flag

- New Hono routes under `packages/opencode/src/server/routes/` that perform
  filesystem, session, auth, MCP, PTY, permission, or upgrade actions without
  `validator()` and without matching existing permission or boundary checks.
- Any use of `directory`, `workspace`, `x-opencode-directory`, or
  `x-opencode-workspace` that bypasses `WorkspaceRouterMiddleware`,
  `Instance.provide`, `Instance.containsPath`, or `assertExternalDirectory`.
- Tool implementations in `packages/opencode/src/tool/` that call
  `Filesystem`, `Process`, `ChildProcess`, provider/network APIs, or mutate
  session state without `ctx.ask()` for the right permission key.
- Share and sync paths (`Share.create/sync/remove/data`, Worker
  `/share_*`, enterprise `/api/share*`) where `secret`, `adminSecret`, or
  session-key prefix checks are missing or applied after state changes.
- Config/plugin/MCP code that loads local files, remote URLs, OAuth callbacks,
  headers, or env vars outside the established `Config` schema,
  `Auth.Service`, and plugin-origin scoping.

## Known false-positives

- `/doc`, `/global/health`, `/global/event`, `/global/sync-event`, and
  `/event` are intended public/introspection or streaming endpoints; judge them
  by leaked payloads, not by missing route auth alone.
- `packages/opencode/src/server/instance.ts` may proxy embedded UI requests to
  `https://app.opencode.ai` and sets a CSP hash for returned HTML; this is a
  fallback UI path, not arbitrary user-chosen proxying.
- `OAUTH_DUMMY_KEY` in `packages/opencode/src/auth` and the Codex plugin is a
  placeholder stripped before provider requests; do not treat it as a real
  secret.
- `test_` share IDs in enterprise share code are deterministic by design for
  tests; production shares use `crypto.randomUUID()` secrets.
- Installer/updater/LSP/ripgrep code intentionally fetches release metadata or
  binaries from known upstreams; findings should require attacker influence over
  target URL, version, path, or install method.
