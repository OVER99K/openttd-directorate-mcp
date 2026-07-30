# Third-party software and specifications

This clean-room repository does not inherit source or history from another OpenTTD MCP implementation.

| Component | Purpose | Licence | Source |
|---|---|---|---|
| Model Context Protocol TypeScript SDK | MCP server and transports | MIT | https://github.com/modelcontextprotocol/typescript-sdk |
| Zod | Runtime request validation | MIT | https://github.com/colinhacks/zod |
| TypeScript | Build toolchain | Apache-2.0 | https://github.com/microsoft/TypeScript |
| tsx | Development runner | MIT | https://github.com/privatenumber/tsx |
| DefinitelyTyped Node types | Type declarations | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| OpenTTD | Runtime, Admin Network, and GameScript APIs | GPL-2.0 | https://github.com/OpenTTD/OpenTTD |

Protocol and API references:

- https://github.com/OpenTTD/OpenTTD/blob/308e75d74d5a0c9df88a7e9c254006c767e8d700/docs/admin_network.md
- https://docs.openttd.org/gs-api/
- https://modelcontextprotocol.io/specification/

OpenTTD itself is not vendored. Its public protocol and API documentation are used for interoperability.
