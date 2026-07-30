# Clean-room development boundary

This repository is an independent implementation. It contains no source, history, patches, generated output, or copied documentation from another OpenTTD control implementation.

## Permitted inputs

- Public OpenTTD Admin Network protocol documentation and API declarations.
- Public OpenTTD GameScript API documentation.
- The Model Context Protocol specification and official MIT-licensed TypeScript SDK.
- Independently written Directorate requirements, tests, and observations from disposable OpenTTD fixtures.
- Open-source references whose licences and source URLs are recorded in `THIRD_PARTY.md`.

## Prohibited inputs

Implementers and reviewers must not inspect, copy, translate, paraphrase line-by-line, or diff against the source or history of prior OpenTTD MCP implementations, including:

- https://github.com/kovan/openttd-mcp
- unpublished or private copies of prior OpenTTD MCP implementations

Interoperability may be verified solely through public protocol/API documentation and black-box tests against OpenTTD.

## Publication evidence

Before publication, verify:

1. Git history begins in this repository and contains no inherited commits or remotes.
2. Dependency licences and public source URLs are recorded.
3. Secret, credential, private-host, and local-path scans pass across the complete history.
4. The exact release SHA passes static checks and the real OpenTTD gate.
5. An independent provenance and implementation review approves the exact release SHA.
