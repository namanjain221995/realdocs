# Build brief for implementation agents

Read this file, `docs/architecture.md`, `packages/contracts/src/*.ts` and the sections of
`RealtimeDocs_Claude_Code_Master_Prompt.txt` relevant to your area **before writing code**.
The master prompt is the product requirement; the architecture document is the design;
the contracts are the wire format. If they conflict, the master prompt wins — report the conflict.

## Environment (verified facts)

- Host: Ubuntu 24.04 **aarch64**, reached over SSH, headless (no display). It is a remote server,
  not the user's Windows/macOS computer. No sudo. Docker 29 + Compose v5 available (user is in the
  `docker` group). No qemu/binfmt: only arm64 containers run.
- Never run git commands that mutate anything (this directory is not a repository; keep it that way).
- Never stop or reconfigure containers/processes you did not start. Many unrelated services run here
  (ports 80, 443, 3000, 4000, 5050, 5432, 8000, 8080, 9000, … are taken).
- Toolchain: prefix **every** shell command with
  `. /home/techsphere/Documents/project/realtimedocs/scripts/dev-env.sh;` — it puts the pinned
  Node.js 24.22.2 and pnpm 12.18.0 on PATH (the system Node 20 is EOL and must not be used).
  Shell state does not persist between commands. Use absolute paths; do not rely on `cd` persisting.
- Local Docker images already present (use them, do not pull others unless required):
  `postgres:17.11-alpine`, `node:24-trixie-slim` (Node 24.21.0), `mcr.microsoft.com/playwright:v1.64.1-noble`
  (Chromium/Firefox/WebKit + Xvfb, Node 24.21.0, run it with `--user 1000:1000 -e HOME=/tmp --network host`).
- Pinned versions (do not upgrade): TypeScript 6.0.3 (typescript-eslint does not support TS 7 yet),
  React 19.3.1, Vite 8.3.7, Vitest 5.1.0, Playwright 1.64.1 (matches the Docker image), Fastify 5.12.8,
  Hocuspocus 4.8.0 (server + provider; **v4 API differs from v2/v3 — read the installed `src/`**),
  Yjs 13.6.33, Tiptap 3.32.3 with `@tiptap/y-tiptap` 3.2.0, Mermaid 12.3.0, zod 4.6.7, Electron 45.2.3,
  `@electron/packager` 20.3.0, ESLint 10 + typescript-eslint 8.72.1, Prettier 3.9.10.
  Many of these majors are newer than typical training data. **Verify every version-sensitive API
  against the installed package types/source in `node_modules`, never from memory.**

## Dependencies

- pnpm enforces a minimum release age (≈1 day). If the newest version of a package is rejected, use
  the previous one. Do not add exclusions to `pnpm-workspace.yaml`.
- Serialize installs across agents and pin exact versions:
  `flock /home/techsphere/Documents/project/realtimedocs/.pnpm-install.lock pnpm --filter <package> add [-D] <name>@<exact-version>`
  then run `node scripts/verify-install.mjs`; if it reports empty manifests run
  `flock /home/techsphere/Documents/project/realtimedocs/.pnpm-install.lock pnpm install --force`.
- Packages with install scripts must be approved in `pnpm-workspace.yaml` (`allowBuilds`). Ask the
  lead (in your report) instead of editing that file, unless the build cannot proceed otherwise.
- Licenses must be permissive (MIT/ISC/BSD/Apache-2.0/OFL). No paid or "pro" editor packages.
- Prefer zero native add-ons. Password hashing uses Node's built-in `crypto.argon2`.

## Ownership (disjoint — do not edit files outside your area)

| Area                                                                                                                                                                     | Owner                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| Root configs, `packages/contracts/**`, `packages/editor/src/schema/**`, `docs/*.md`                                                                                      | lead                                                            |
| `apps/server/**`, `packages/editor/src/export/**`, `docker-compose.yml`, `Dockerfile`, `.env.example`, `scripts/init-env.mjs`, `scripts/backup.sh`, `scripts/restore.sh` | server agent                                                    |
| `packages/editor/**` except `src/schema/**` and `src/export/**`                                                                                                          | editor agent                                                    |
| `packages/ui/**`                                                                                                                                                         | UI agent (already built; treat as read-only and report defects) |
| `apps/web/**`                                                                                                                                                            | web agent                                                       |
| `apps/desktop/**`                                                                                                                                                        | desktop agent                                                   |
| `tests/e2e/**`, `tests/perf/**`                                                                                                                                          | test agent (later wave)                                         |

If a contract or schema is missing something you need, do **not** edit the lead's files: add the
piece in a clearly named local file (for example `src/contract-additions.ts`) and list it in your
report so the lead can merge it. Each agent writes its durable notes (commands that exist, limits,
measured results, known gaps) to `docs/notes/<area>.md`.

## Ports and resource names

| Use                   | Value                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------- |
| Product defaults      | server `4310`, web dev server `4311`, PostgreSQL host port `54310` (all bound to 127.0.0.1) |
| Server agent scratch  | ports `4410–4419`, PostgreSQL `54410–54419`, containers named `rd-srv-*`                    |
| Editor agent scratch  | ports `4420–4429`, containers `rd-ed-*`                                                     |
| Web agent scratch     | ports `4430–4439`, PostgreSQL `54430–54439`, containers `rd-web-*`                          |
| Desktop agent scratch | ports `4440–4449`, PostgreSQL `54440–54449`, containers `rd-desk-*`                         |
| E2E / perf            | ports `4320–4339`, PostgreSQL `54320–54339`, containers `rd-e2e-*`, `rd-perf-*`             |

Bind everything to `127.0.0.1`. Use `strictPort`. Remove only containers you created, by exact name.
Stop every process you start before you finish.

## Code conventions

- TypeScript strict; ESM; internal packages are consumed as source (`exports` point at `.ts`).
- `pnpm exec eslint <your dir>`, `pnpm exec prettier --check <your dir>`, your package's
  `typecheck` script and your tests must pass before you report. Do not weaken lint rules or
  `tsconfig` strictness; do not add `eslint-disable` without a one-line justification.
- Unit tests: Vitest, one `vitest.config.ts` per package with a unique `test.name`; run with
  `pnpm exec vitest run --project <name>` from the repo root.
- No secrets, document bodies, passwords, tokens or share secrets in logs or error messages.
- Never "fix" a failure by disabling authorization, CORS/origin checks, TLS verification, CSP or
  Electron protections.
- Write honest notes: say exactly what you ran and what you did not or could not run. Never claim a
  build, test or measurement you did not observe.

## API details not obvious from the contracts

- `packages/contracts/src/client.ts` is the reference for request/response pairing
  (for example `PATCH /api/users/:id` → `UsersResponse`, member set/remove → `MembersResponse`,
  profile update → `SessionResponse`, logout/delete → `204`).
- Errors: always `ApiErrorBody` JSON with the status from `HTTP_STATUS_BY_CODE`.
- The stateless collaboration protocol, presence rules and status model are specified in
  `packages/contracts/src/collab.ts` and `docs/architecture.md` §5.
- Document schema: `@realtimedocs/editor/schema` (DOM-free). Node names and attributes there are
  authoritative; the Yjs fragment field is `Y_FRAGMENT_FIELD` (`'default'`).
