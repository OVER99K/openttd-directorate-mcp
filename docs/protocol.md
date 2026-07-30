# Protocol notes

## Clean-room sources

- OpenTTD Admin Network documentation at pinned revision `308e75d74d5a0c9df88a7e9c254006c767e8d700`: https://github.com/OpenTTD/OpenTTD/blob/308e75d74d5a0c9df88a7e9c254006c767e8d700/docs/admin_network.md
- Admin Network declarations: https://github.com/OpenTTD/OpenTTD/blob/308e75d74d5a0c9df88a7e9c254006c767e8d700/src/network/core/tcp_admin.h
- Packet declarations: https://github.com/OpenTTD/OpenTTD/blob/308e75d74d5a0c9df88a7e9c254006c767e8d700/src/network/core/packet.h
- Network MTU declarations: https://github.com/OpenTTD/OpenTTD/blob/308e75d74d5a0c9df88a7e9c254006c767e8d700/src/network/core/config.h
- MCP specification and SDK sources are recorded in `THIRD_PARTY.md`.

## Wire assumptions

- TCP packets begin with a little-endian `uint16` total size followed by a `uint8` packet type; total size includes the size and type bytes.
- Multi-byte integer fields are little-endian and strings are NUL-terminated.
- The default bound is OpenTTD's 1460-byte compatibility MTU. Configuration may raise it only to the documented TCP maximum.
- Missing terminators, truncated fields, undersized or oversized packets, and excessive buffered input are protocol errors.
- The client sends `AdminJoin`, becomes active only after `ServerWelcome`, and subscribes to GameScript updates only when the advertised protocol permits automatic updates.
- Current OpenTTD versions disable insecure `AdminJoin` by default. `AdminJoinSecure` is not implemented; local use must explicitly enable insecure admin login.

## Directorate envelope

- GameScript requests are JSON strings with `request_id`, `op`, and `payload`.
- Responses are correlated by request ID and may be chunked using `chunk_index`, `chunk_count`, and `chunk`.
- Reassembled responses must contain an explicit boolean `ok`; malformed or uncorrelated responses fail closed.
- `apply` uses a caller-supplied `operation_id`. Rollback also requires a distinct `target_operation_id`.
- `commission` maps to the GameScript command `commission_route`.
- `verify` requires exactly one target: `route_id`, `plan_id`, or `operation_id`.
- Operation verification performs a bounded journal lookup and truthful replay rather than claiming success from request acceptance.
- RCON is restricted to one in-flight request because response packets carry no request ID.
- Admin chat has no acknowledgement packet; sending chat therefore never reports correlated success.
