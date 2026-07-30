# Architecture

## Control split

1. MCP layer validates typed requests and enforces request-level guardrails.
2. Admin gateway owns transport, packet decoding, correlation, and timeout behavior.
3. GameScript bridge performs envelope dispatching and strict command verification.
4. Planner/kernel owns bounded route search, route composition, and durable state.
5. Registry and operation journal provide persistence, replay, and proof generation.

## Public-facing intent

- `observe(scope, company_id, ...)`
- `plan(intent, company_id, policy, plan_id?, revision?)`
- `apply(company_id, plan_id, revision, phase)`
- `commission(company_id, plan_id, route_id, cargo_label)`
- `verify(company_id, route_id?, operation_id?, plan_id?, level)`
- `execute(command, company_id?, params)`
- `chat(message)` and `rcon(command)`

## Stability and invariants

- No defaulted company inference for mutation operations.
- Input is explicit and bounded; no free-form tile/path arrays are accepted for planning.
- `apply` and `commission` require exact revision/fingerprint keys.
- `preflight` is legal-check-only under `GSTestMode`.
- `commit` and `rollback` are fenced by operation IDs and persisted journal state.
- Verification includes topology, commissioning checks, and profitability/vehicle health reporting.

## Delivered milestone lineage

This repository now promotes the previously milestone-4 package lineage as the stable package:

- Stable package: `game/openttd_directorate`
- Public identity: `OpenTTDDirectorate` / `OpenTTDDirectorateInfo`
- Package display: `OpenTTD Directorate`, short name `DRCT`
- Public version: `4`
- Public date: `2026-07-30`

Legacy milestone directories are removed.
