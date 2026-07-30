# Verification Evidence

Accepted milestone basis: `6eca468e8173eb7e2c7010e7ec4cc3dd3ab6a667`.

## Release verification workflow

For every public release SHA, run the full real-engine gate and retain its external evidence artifact with the release record.

- `npm run test` validates static typing and deterministic unit/integration fixtures.
- `tests/integration/directorate-real-engine-gate.mjs` performs the end-to-end OpenTTD gate.

The real-engine gate writes JSON evidence to either:

- `${OPENTTD_GATE_EVIDENCE_PATH}` when set, or
- a temporary path under `os.tmpdir()` by default.

## Public release evidence policy

Do not claim final-release proof against the accepted milestone SHA `6eca468`; public release proof must target the final release commit SHA that is actually released.
