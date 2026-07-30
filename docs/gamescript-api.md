# GameScript API provenance

The stable `game/openttd_directorate` package was implemented from this repository and official OpenTTD documentation and declarations only.

Pinned OpenTTD revision used for API recording: `308e75d74d5a0c9df88a7e9c254006c767e8d700`.

## Official references consulted

- `GSAdmin` declaration: https://github.com/OpenTTD/OpenTTD/blob/308e75d74d5a0c9df88a7e9c254006c767e8d700/src/script/api/script_admin.hpp
  - `GSAdmin.Send(table)` sends JSON-convertible tables. Responses are chunked at 512 characters to remain under the documented GameScript/Admin payload threshold after envelope overhead.
- `GSEventController` and `GSEventAdminPort`: https://github.com/OpenTTD/OpenTTD/blob/308e75d74d5a0c9df88a7e9c254006c767e8d700/src/script/api/script_event.hpp and https://github.com/OpenTTD/OpenTTD/blob/308e75d74d5a0c9df88a7e9c254006c767e8d700/src/script/api/script_event_types.hpp
  - Admin messages arrive as `GSEvent.ET_ADMIN_PORT`; the bridge polls with a per-tick bound and converts through `GSEventAdminPort.Convert`.
- `GSRail`: https://docs.openttd.org/gs-api/classGSRail
  - Used for legality checks, construction, connectivity readback, vehicle infrastructure, and bounded rollback.
- `GSTestMode`: https://docs.openttd.org/gs-api/classGSTestMode
  - Preflight executes the full proposed build program in test mode without intentional mutation.
- `GSCompanyMode`: https://docs.openttd.org/gs-api/classGSCompanyMode
  - Mutating and company-scoped queries always use an explicit company.
- `GSMap`: https://docs.openttd.org/gs-api/classGSMap
  - Tile coordinate transforms and map-bound checks derive from the official API.
- `GSController`: https://docs.openttd.org/gs-api/classGSController
  - Defines lifecycle, bounded polling, save, and load behavior.
- `GSInfo`: https://docs.openttd.org/gs-api/classGSInfo
  - Defines the loadable package identity and version metadata.
- GameScript manual: https://wiki.openttd.org/en/Manual/Game%20script
- Script introduction: https://wiki.openttd.org/en/Development/Script/Introduction

## Stable package contract

- Public package directory: `game/openttd_directorate`
- Display name: `OpenTTD Directorate`
- Short name: `DRCT`
- Public version: `4`
- Controller: `OpenTTDDirectorate`
- Info class: `OpenTTDDirectorateInfo`
- Internal `D4_*` and `DIRECTORATE_M4_*` symbols are retained to preserve the independently accepted kernel and save envelope.

## Implemented assumptions

- Requests are JSON-converted tables containing `request_id`, `op`, and `payload`.
- Responses contain explicit boolean `ok` and are returned in correlated chunks.
- Planning is bounded and rejects caller-provided tile/path lists.
- `apply` supports mutation-free preflight, journalled commit, and created-assets-only rollback.
- Commissioning configures orders and vehicles only after topology and ownership checks.
- Verification supports plan, operation, and route targets; economic success requires observed positive revenue.
- Save/load preserves plans, operation journal entries, routes, and replay semantics within explicit bounds.
