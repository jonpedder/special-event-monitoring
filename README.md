# Special Event Operations — Pedder local source package

This folder contains the deployed Special Events Audit solution source and its reproducible provisioning specifications. Portal IDs and remaining manual deployment steps are recorded in `deployment.json`.

## Actual ArcGIS resources

| Role | Existing resource |
|---|---|
| Portal | `https://publicsafety.maps.arcgis.com` |
| Source | Item `53d7f0d643a14d1a8de20ca6e687f21a`, layer `0` |
| Audit | Item `9fb69f32b67242e8a5ba093b0bfab9ae`, layer `0` |
| Audit URL | `https://services6.arcgis.com/SdBwj74JF24xKhpX/arcgis/rest/services/Special_Event_Asset_Audit_Log_20261030_144101/FeatureServer/0` |
| Workflow Manager | Item `8c3a1add5d444b089e9d077e3e940962` |
| Companion Web Map | Item `6d26cea81f8e4568aa505920f06e5291` |

The design now uses the existing **single audit point layer**. It does not require or reference placeholder `MovementSegments`, `AssetSnapshot`, or `IntegrationState` datasets.

## Public application shell

The repository is published with GitHub Pages at:

`https://jonpedder.github.io/special-event-monitoring/`

The page itself and source repository are public. Operational ArcGIS layers remain private and require an authorized Public Safety ArcGIS Online sign-in through OAuth application item `21fa6f4b3f7f4bad823345a69d173d28`. The root page, `index.html`, and `oauth-callback.html` are registered redirect URIs. No ArcGIS or GitHub token is stored in this repository.

## Contents

| File | Purpose |
|---|---|
| `special-event-audit.ipynb` | Scheduled ArcGIS Notebook processor using `GIS("home")`; resolves both portal items/layers, reconstructs latest state from audit history, appends idempotent changes, calculates movement, retains delete geometry, optionally creates WFM jobs, and attempts a Notebook-item lease. |
| `audit-schema.json` | Documentation for the actual existing audit layer and supplied fields. It is not a service-provisioning payload. |
| `workflow.spec.json` | Preserved offline Workflow Manager provisioning specification. |
| `dashboard.spec.json` | Preserved offline Dashboard specification. |
| `index.html`, `app.js`, `styles.css`, `config.json` | ArcGIS Maps SDK for JavaScript 5.1 + Calcite authenticated AAR/playback application. |
| `settings.html`, `settings.mjs` | Browser-local operational defaults plus the tabbed Help & How-to operator guide. |

## Audit model

The audit fields are:

`OBJECTID`, `GlobalID`, `SourceObjectID`, `SourceGlobalID`, `EventID`, `UnitID`, `EventAssetID`, `UnitLocation`, `UnitType`, `ChangeType`, `ChangeDateTime`, `EditorUser`, `ProcessedDateTime`, `DeliveryKey`, `SourceLayerURL`, `IsLastKnown`, `WFMJobID`, `WFMStatus`, `WFMAttemptCount`, `WFMLastError`, `WFMCompletedDate`, and `WFMPayload`.

`ChangeType` is `ADD`, `UPDATE`, or `DELETE`. The processor sorts rows by `ChangeDateTime`, then `OBJECTID`, and takes the last row for each `SourceObjectID`. A latest `DELETE` is inactive; its geometry is the prior last-known point.

The source's known business fields are `unitid`, `eventid`, `uniqueid`, `unitloc`, `unittype`, `poststatus`, and `staffagency`, plus system ObjectID/GlobalID/editor-tracking fields discovered at runtime. The state hash includes all non-system attributes and normalized geometry. This detects `poststatus` and `staffagency` changes even though the audit layer has no dedicated columns for them. The hash is embedded in `DeliveryKey`.

## Configure and schedule the Notebook

The Notebook is published as **Special Event Audit Processor**, item `21aee7d6ee4746d8bfa236acea698148`, in the Special Event Operations - Pedder folder. Its deployed code has `DRY_RUN = False`, `CREATE_WFM_JOBS = True`, and Workflow Manager template `MFgMCmMtTQCNzs3dgSdeRA`.

The active task `68b651cae3a04d738abf445a77014c97` runs every 15 minutes with a 10-minute timeout, the shortest supported recurring interval in this organization. Review each task run for source count, audit additions, prior flags cleared, inferred deletes, WFM reconciliations, closed jobs, and failures.

The processor pages a complete source snapshot. Absence from that complete read defines a delete. A circuit breaker refuses more than 25 inferred deletes, or a drop of at least 50 percent when at least five assets were previously active. Operations must investigate the source service, permissions, filters, and count before changing those thresholds or rerunning.

### Lease behavior

The processor stores a short lease in the Notebook item's `properties`. It accepts an injected item ID through `ARCGIS_NOTEBOOK_ITEM_ID`, `NOTEBOOK_ITEM_ID`, or `NB_ITEM_ID` and falls back to the deployed Notebook item ID. The 10-minute task timeout is also shorter than the 15-minute interval. If property access is unavailable, the run stops relying on the scheduler timeout rather than creating a second writer intentionally.

### Workflow Manager exceptions

The target Workflow Manager item is `8c3a1add5d444b089e9d077e3e940962`.

The workflow diagram and job template are provisioned. The job template ID is `MFgMCmMtTQCNzs3dgSdeRA`; reviewer group `af81bbfd590d45c28c749cb045ca42de`; supervisor group `2c7cdc7318924ef9baea39158cd6f169`.

With `FULLY_AUTOMATE_WFM = True`, each qualifying `DELETE` or movement of at least `100` metres creates a Workflow Manager job carrying the deterministic Notebook payload in extended properties, the description, and job comments. The Notebook then supplies the diagram's manual and question responses through the Workflow Manager notification websocket, follows the DELETE or MAJOR_MOVE branch, documents the automated resolution, acknowledges the end step, and closes the job. A non-production DELETE-branch job was verified at 100 percent/Closed and removed after the test.

The audit layer stores WFM job ID, status, attempt count, payload, completion date, and last error. Deterministic job names derived from `DeliveryKey` prevent duplicate jobs. Each scheduled run reconciles `PENDING`, `PROCESSING`, and `FAILED` rows for up to five attempts, resuming an existing Workflow Manager job when found and marking the audit row `CLOSED` only after the WFM job closes.

### Synthetic lifecycle verification

The `QA-AUDIT-20261114` test set contains 50 current source features near Sacramento. Verified audit history contains 80 rows: 55 adds, 20 updates, and 5 deletes. Tests covered attribute-only changes, five movements below 100 metres, five movements above 100 metres, five deletes, five re-adds, and an unchanged retry. All 10 qualifying major-move/delete Workflow Manager jobs reached `CLOSED`; no WFM delivery rows remain pending, processing, or failed. The final unchanged scheduled run added zero audit rows.

## Configure and deploy the AAR app

`config.json` is set to the target portal, source item/layer, audit layer URL, browser OAuth client ID, and a five-minute refresh interval. GitHub Pages serves the folder over HTTPS. The OAuth app permits the exact Pages URL as its redirect URI; never embed a token or client secret.

The public shell now uses an explicit ArcGIS sign-in gate, loads and displays the authenticated user's full name and username, provides sign-out, UTC and Pacific clocks, Workflow Manager attribution, and a header link to `settings.html`. The settings page follows the CA Security Ops configuration/help format. It stores browser-local defaults for the audit window, refresh cadence, playback speed, basemap, and movement arrows; it also provides a task-focused Help & How-to guide. These preferences change presentation only and never alter portal content or Workflow Manager data.

Playback keeps the operator's current map viewpoint instead of zooming to each triggered update. With no list selection it reconstructs every filtered asset. Selecting an asset resets the time slider and scopes the same player to that asset's ordered updates, position, and growing movement trail; clearing the selection restores all-asset playback.

The map is backed by Web Map `6d26cea81f8e4568aa505920f06e5291` and includes explicit Zoom and Home controls plus collapsible Layers, Basemaps, and Bookmarks tools. The app seeds a Current staffing extent bookmark at startup; additional bookmarks are session-local unless they are later saved to the Web Map through an authorized publishing workflow.

While the page is visible and playback is stopped, the application refreshes both feature layers, advances the rolling time window, reloads audit history, redraws the map, and recalculates KPIs at the browser-selected cadence (five minutes by default). A hidden tab refreshes immediately when it becomes visible after missing an interval.

Release verification should cover authorization failures, event filters, timezone boundaries, long audit histories, empty states, playback, trail selection, KPI reconciliation, CSV encoding, and responsive layout.

The app preserves current-source context by displaying the source item layer, but derives AAR playback state and per-unit polylines entirely client-side from audit point records ordered by `ChangeDateTime` and `OBJECTID`. It loads audit history through the selected end time so it can reconstruct a correct baseline at the start of the window.

## Verified configuration and remaining host dependency

- Source and audit schemas, capabilities, editor tracking, field lengths, nullability, editability, counts, and Web Mercator spatial references were inspected live.
- Audit business fields are editable, and `UX_Audit_DeliveryKey` is a unique service index.
- `SourceObjectID` remains the reconstruction key. If the source service is overwritten and ObjectIDs are recycled, GlobalID mismatch handling still requires an explicit operational policy.
- Movement distance supports WKID 4326/4269 and Web Mercator. Other coordinate systems need a validated projection/geodesic implementation.
- Event records are append-only, but `IsLastKnown` and WFM delivery fields are administrative state updates. Latest asset state is reconstructed by time and ObjectID, not by `IsLastKnown` alone.
- The AAR app uses the CA Security Ops dark navy/gold design and queries all matching audit records through the selected end time. Very large histories may require a server-side baseline or maximum lookback.
- Trails represent observed audit-to-audit movement, not routed travel paths.
- Historical `poststatus` and `staffagency` influence change detection through the embedded state hash but do not have dedicated audit columns.
- External launch uses GitHub Pages and OAuth redirect URI `https://jonpedder.github.io/special-event-monitoring/`. The repository is public, but ArcGIS data access remains governed by portal permissions.
