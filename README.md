# OpenTTD Directorate MCP

Clean-room MCP and OpenTTD GameScript integration for deterministic transport planning and route commissioning.
Use your LLM Ai agent to play openttd. 

## Status

- Canonical milestone package lineage has been promoted to a stable package identity.
- The stable package now lives at `game/openttd_directorate` and exposes:
  - `OpenTTDDirectorateInfo`
  - `OpenTTDDirectorate`
  - package name `OpenTTD Directorate`
  - short name `DRCT`
  - `GetVersion() == 4`
  - `GetDate() == "2026-07-30"`
- Internal implementation identifiers remain intentionally `D4_*` and `DIRECTORATE_M4_*`.
- Legacy milestone package directories are removed from this branch.

## Implemented stack

- MCP server and typed tool contracts (`observe`, `plan`, `apply`, `commission`, `verify`, `execute`, `chat`, `rcon`).
- Admin network transport with chunked request/response correlation and bounded buffering.
- Route planning and search persistence in GameScript, including bounded search state, station placement, build program compilation, and operation journal.
- Route commission and verification (`topology`, `commissioning`, `economic`) with idempotent/duplicate-safe operation IDs.
- Real-world integration is validated by a disposable OpenTTD 15.3 gate.
- Static and typed contract tests for protocol/tool behavior.

## Architecture (brief)

1. MCP adapter validates request envelopes and maps typed tools to gateway calls.
2. Admin gateway manages authentication, packet I/O, timeouts, retries, and correlation.
3. GameScript bridge receives/dispatches JSON envelopes and enforces command-level guards.
4. Planner/kernel code keeps bounded plans and operation state.
5. Route registry stores commissioned route state and supports readback, replay, and proof generation.

## Commands

```sh
npm ci --ignore-scripts
npm run build
npm run check
npm audit --audit-level=high
npm start
```

## OpenTTD 15.3 requirements

- OpenTTD 15.3 available in `PATH` or through `OPENTTD_15_BIN`.
- OpenGFX installed in a standard OpenTTD user/system location or supplied through `OPENTTD_OPENGFX_DIR`.

## Run MCP (safe defaults)

```sh
cp .env.example .env
npm run dev
```

Example `.env` (secrets omitted):

```sh
OPENTTD_ADMIN_HOST=127.0.0.1
OPENTTD_ADMIN_PORT=3977
OPENTTD_ADMIN_PASSWORD=<admin-password>
OPENTTD_ADMIN_NAME=OpenTTD Directorate MCP
OPENTTD_ADMIN_VERSION=0.1.0
MCP_TRANSPORT=stdio
MCP_BIND_HOST=127.0.0.1
MCP_PORT=8797
OPENTTD_REQUEST_TIMEOUT_MS=15000
OPENTTD_CONNECT_TIMEOUT_MS=10000
OPENTTD_PING_INTERVAL_MS=30000
```

## OpenTTD installation

Copy the stable GameScript package into OpenTTD's user GameScript directory:

```sh
mkdir -p ~/.local/share/openttd/game
cp -a game/openttd_directorate ~/.local/share/openttd/game/
```

Select release version 4 in `openttd.cfg`:

```ini
[game_scripts]
"OpenTTD Directorate" = 4
```

The integration gate copies this directory into a disposable fixture; it never writes into the tracked package.

## MCP client config examples

```json
{
  "mcpServers": {
    "openttd-directorate": {
      "command": "node",
      "args": ["--env-file=.env", "dist/src/index.js"],
      "env": {
        "MCP_TRANSPORT": "stdio"
      }
    }
  }
}
```

No bearer token is required for stdio mode.

## Testing and verification

```sh
npm run check
npm audit --audit-level=high
npm run test
```

Optional exact engine gate (does not run by default):

```sh
OPENTTD_15_BIN=/path/to/openttd-15.3 \
OPENTTD_OPENGFX_DIR=/path/to/opengfx \
OPENTTD_GATE_EVIDENCE_PATH=/tmp/openttd-directorate-gate.json \
node tests/integration/directorate-real-engine-gate.mjs
```

The gate writes evidence by default to a temp file path and keeps fixtures out of the repo unless `OPENTTD_GATE_KEEP_FIXTURE=1`.

## Typed end-to-end evidence gates

- `tests/integration/directorate-real-engine-gate.mjs` is the canonical real-engine gate target.
- `docs/verification.md` records accepted SHA and release evidence policy.

## Security boundaries

- MCP defaults to `stdio` transport.
- `streamable_http` is currently disabled intentionally.
- Admin credentials are redacted in logs.
- No secrets are committed in repository examples.

## Limitations

- `AdminJoinSecure` is not the transport default yet.
- Real-engine integration remains optional and resource intensive.
- Dispatcher assumes explicit bounded requests and rejects untrusted path-like planning payloads.
- Chat and RCON are tightly bounded by protocol semantics.

## Release provenance

- See [`CLEAN_ROOM.md`](CLEAN_ROOM.md) for clean-room boundaries and forbidden references.
- See [`THIRD_PARTY.md`](THIRD_PARTY.md) for external specs and licences.
- See [`docs/verification.md`](docs/verification.md) for proof policy and accepted SHA.

## License

MIT
