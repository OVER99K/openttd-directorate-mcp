# Verification Evidence

## Release verification workflow

Every public release must be verified at the exact commit SHA that will be published.

The accepted release SHA is intentionally not hard-coded in this tracked file: adding a commit SHA to a file inside that same commit would change the SHA. Exact-SHA evidence therefore lives outside the Git tree in the release record, CI artifact, or signed review record.

For each release candidate:

1. Start from a clean checkout of the exact candidate commit.
2. Run `npm ci --ignore-scripts`.
3. Run `npm run check` and require the complete test suite to pass.
4. Run `npm audit --audit-level=high` and require no high-severity findings.
5. Run `tests/integration/directorate-real-engine-gate.mjs` against OpenTTD 15.3.
6. Require the engine evidence to report the exact candidate in `source_commit` and `source_dirty: false`.
7. Require successful typed MCP planning, application, commissioning, topology verification, economic revenue, save/restart persistence, and idempotent replay.
8. Retain the external JSON evidence artifact with the release record.
9. Obtain an independent review of that same exact candidate SHA before publishing it.

## Evidence artifact

The real-engine gate writes JSON evidence to either:

- `${OPENTTD_GATE_EVIDENCE_PATH}` when set; or
- a temporary path under `os.tmpdir()` by default.

A valid release record includes at least:

- candidate Git SHA;
- `source_dirty` state;
- OpenTTD version and binary SHA-256;
- static test and audit results;
- typed MCP-to-GameScript gate results;
- profitable-delivery evidence;
- save/restart and replay results; and
- the independent reviewer decision.

Historical milestone evidence is development provenance only. It must never be presented as proof for a later public release.
