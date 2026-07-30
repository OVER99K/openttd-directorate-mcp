# OpenTTD Directorate MCP

Give an LLM agent a bounded, verifiable control plane for playing OpenTTD.

OpenTTD Directorate connects an MCP-capable agent to an OpenTTD 15.3 server. The agent can inspect the live world, plan transport routes, apply construction programs, commission vehicles, and verify that a route actually works and earns money. It is designed for persistent autonomous play without reducing the game to blind console commands.

This is both:

- a TypeScript MCP server that exposes typed tools to an AI agent; and
- an OpenTTD GameScript package that performs guarded planning, construction, persistence, and verification inside the game.

It is not an AI model, an OpenTTD server distribution, or a save-game bot. You bring OpenTTD, an MCP client, and the agent you want to operate it.

## What an agent can do

The MCP surface exposes:

- `observe` — read map, company, route, plan, and economy state;
- `plan` — create and advance bounded route plans;
- `apply` — execute a compiled construction program;
- `commission` — buy and configure the first vehicle for a route;
- `verify` — prove topology, commissioning, and economic operation;
- `execute` — issue explicitly allowed GameScript commands;
- `chat` — send bounded in-game chat messages; and
- `rcon` — perform explicitly authorized server administration.

A successful tool response is not treated as proof by itself. Plans and operations are persisted, operation IDs are replay-safe, and commissioned routes can be read back and checked for topology, vehicle movement, cargo delivery, and revenue.

## Why this exists

Most generic game-control bridges expose low-level actions and leave the agent to guess whether they worked. OpenTTD Directorate adds the missing operating layer:

1. typed MCP contracts;
2. authenticated OpenTTD Admin Network transport;
3. a GameScript request/response bridge;
4. bounded station and route planning;
5. deterministic build programs;
6. persistent plan and operation journals; and
7. explicit post-build verification.

That makes it suitable for agents that need to resume after disconnects, avoid duplicating operations, and distinguish “the command returned success” from “the railway actually carries cargo profitably.”

## Architecture

```text
LLM agent / MCP client
        |
        | MCP tools
        v
TypeScript MCP server
        |
        | OpenTTD Admin Network protocol
        v
OpenTTD dedicated server
        |
        | JSON envelopes through Admin <-> GameScript bridge
        v
OpenTTD Directorate GameScript
        |
        +-- planner and site survey
        +-- build-program compiler
        +-- operation journal
        +-- route registry
        `-- topology / commissioning / economic verification
```

More detail:

- [`docs/architecture.md`](docs/architecture.md)
- [`docs/protocol.md`](docs/protocol.md)
- [`docs/gamescript-api.md`](docs/gamescript-api.md)
- [`docs/verification.md`](docs/verification.md)

## Current package

The stable GameScript package lives at `game/openttd_directorate` and exposes:

- class `OpenTTDDirectorateInfo`;
- class `OpenTTDDirectorate`;
- package name `OpenTTD Directorate`;
- short name `DRCT`;
- version `4`; and
- release date `2026-07-30`.

Internal `D4_*` and `DIRECTORATE_M4_*` identifiers are intentionally retained as implementation-level lineage markers.

## Requirements

- Node.js 20 or newer;
- OpenTTD 15.3;
- OpenGFX in a standard OpenTTD location, or provided through `OPENTTD_OPENGFX_DIR`; and
- an MCP-capable agent/client.

## Install and build

```sh
git clone https://github.com/OVER99K/openttd-directorate-mcp.git
cd openttd-directorate-mcp
npm ci --ignore-scripts
npm run build
```

Install the GameScript package into OpenTTD's user data directory:

```sh
mkdir -p ~/.local/share/openttd/game
cp -a game/openttd_directorate ~/.local/share/openttd/game/
```

Select release version 4 in `openttd.cfg`:

```ini
[game_scripts]
"OpenTTD Directorate" = 4
```

## Configure and run the MCP server

```sh
cp .env.example .env
```

Minimum configuration:

```sh
OPENTTD_ADMIN_HOST=127.0.0.1
OPENTTD_ADMIN_PORT=3977
OPENTTD_ADMIN_PASSWORD=<admin-password>
OPENTTD_ADMIN_NAME=OpenTTD Directorate MCP
OPENTTD_ADMIN_VERSION=0.1.0
MCP_TRANSPORT=stdio
OPENTTD_REQUEST_TIMEOUT_MS=15000
OPENTTD_CONNECT_TIMEOUT_MS=10000
OPENTTD_PING_INTERVAL_MS=30000
```

Start it:

```sh
npm run dev
```

Production build:

```sh
npm run build
npm start
```

Example MCP client configuration:

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

No bearer token is required in stdio mode. The public release intentionally keeps `streamable_http` disabled; do not expose the Admin port or credentials to untrusted networks.

## Components used and borrowed foundations

OpenTTD Directorate is an independent clean-room implementation, but it deliberately builds on established open-source software and public specifications:

- [OpenTTD](https://github.com/OpenTTD/OpenTTD) — game runtime plus the documented Admin Network and GameScript APIs; GPL-2.0.
- [Model Context Protocol](https://modelcontextprotocol.io/specification/) — tool and transport protocol used between the agent and this server.
- [Model Context Protocol TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) — MCP server and transport implementation; MIT.
- [Zod](https://github.com/colinhacks/zod) — runtime validation for requests and configuration; MIT.
- [TypeScript](https://github.com/microsoft/TypeScript) — implementation language and compiler; Apache-2.0.
- [Node.js](https://github.com/nodejs/node) — JavaScript runtime; MIT.
- [tsx](https://github.com/privatenumber/tsx) — development-time TypeScript runner; MIT.
- [DefinitelyTyped Node types](https://github.com/DefinitelyTyped/DefinitelyTyped) — Node.js type declarations; MIT.
- [OpenGFX](https://github.com/OpenTTD/OpenGFX) — open graphics set used by disposable OpenTTD fixtures and engine verification; GPL-2.0.
- Public [OpenTTD Admin Network documentation](https://github.com/OpenTTD/OpenTTD/blob/308e75d74d5a0c9df88a7e9c254006c767e8d700/docs/admin_network.md) and [GameScript API documentation](https://docs.openttd.org/gs-api/) — interoperability references.

No source or history was copied from prior OpenTTD MCP implementations. The precise clean-room boundary and complete licence/source table are recorded in [`CLEAN_ROOM.md`](CLEAN_ROOM.md) and [`THIRD_PARTY.md`](THIRD_PARTY.md).

## Testing and verification

```sh
npm run check
npm audit --audit-level=high
```

Optional exact OpenTTD 15.3 engine gate:

```sh
OPENTTD_15_BIN=/path/to/openttd-15.3 \
OPENTTD_OPENGFX_DIR=/path/to/opengfx \
OPENTTD_GATE_EVIDENCE_PATH=/tmp/openttd-directorate-gate.json \
node tests/integration/directorate-real-engine-gate.mjs
```

The gate uses a disposable fixture and does not write into the tracked GameScript package. Set `OPENTTD_GATE_KEEP_FIXTURE=1` only when retaining a failed fixture for diagnosis.

## Security boundaries

- MCP defaults to stdio transport.
- Admin credentials are redacted from logs.
- Planning payloads and buffers are bounded.
- Path-like untrusted planning inputs are rejected.
- Chat and RCON remain narrow, explicit surfaces rather than general gameplay shortcuts.
- No credentials or deployment-specific secrets belong in the repository.

## Limitations

- OpenTTD 15.3 is the validated engine target.
- `AdminJoinSecure` is not yet the default transport handshake.
- Exact engine verification is optional and resource intensive.
- Autonomous play still requires an agent operating policy: company ownership, spending limits, destructive-action gates, and multiplayer etiquette are not choices the protocol should silently invent.

## Creator and contributor

OpenTTD Directorate was designed and built by **Nicolette**, an autonomous AI researcher, writer, and systems operator at [nicai.space](https://nicai.space/).

Nicolette is the primary author and maintainer of the MCP server, OpenTTD GameScript integration, planning and verification model, test suite, and documentation. Human direction and operational testing were provided through the nicai.space project environment.

## Release provenance

- [`CLEAN_ROOM.md`](CLEAN_ROOM.md) defines permitted and prohibited implementation inputs.
- [`THIRD_PARTY.md`](THIRD_PARTY.md) records external software, specifications, licences, and source URLs.
- [`docs/verification.md`](docs/verification.md) defines exact-SHA evidence and release acceptance policy.

## License

MIT. See [`LICENSE`](LICENSE).
