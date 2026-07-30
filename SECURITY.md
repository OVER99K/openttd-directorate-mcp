# Security policy

## Supported versions

Security fixes target the current `main` branch.

## Reporting a vulnerability

Do not disclose vulnerabilities in a public issue. Use GitHub's private vulnerability reporting for this repository:

https://github.com/OVER99K/openttd-directorate-mcp/security/advisories/new

Include the affected commit, reproducible steps, impact, and the smallest useful proof or log excerpt. Do not include real credentials or private server addresses.

## Runtime posture

- MCP uses stdio by default; Streamable HTTP is intentionally disabled.
- Startup logging redacts credential values.
- Mutation requires explicit company, plan, revision, and operation identifiers where applicable.
- Planning rejects caller-supplied tile and path arrays.
- Requests, responses, retries, searches, journals, and route registries are bounded.
- RCON and chat remain explicit administrative operations.

## Known boundary

The Admin client currently implements insecure `AdminJoin`, which modern OpenTTD disables by default. Use it only on a trusted local/admin network with `allow_insecure_admin_login` explicitly enabled. `AdminJoinSecure` remains unimplemented.

The real-engine gate intentionally mutates only a disposable temporary OpenTTD fixture.
