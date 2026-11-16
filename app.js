import { loadSettings } from "./settings.mjs";

const ui = Object.fromEntries([
  "eventSelect", "fromTime", "toTime", "applyButton", "playButton", "timeSlider", "speedSlider",
  "speedLabel", "playbackLabel", "playbackScope", "exportButton", "notice", "refreshAction", "assetList", "timeline", "assetSummary", "resetExtentButton",
  "kpiAssets", "kpiAdds", "kpiMoves", "kpiDistance", "kpiDeletes", "authScreen", "authLoading", "signInButton", "authError", "appShell",
  "authFullName", "authUsername", "userIdentity", "utcTime", "pacificTime", "settingsAction", "signOutAction"
].map((id) => [id, document.getElementById(id)]));

const state = {
  config: null,
  userSettings: loadSettings(),
  IdentityManager: null,
  credential: null,
  view: null,
  layers: {},
  graphics: {},
  Graphic: null,
  auditRows: [],
  timer: null,
  autoRefreshTimer: null,
  lastAutoRefresh: 0,
  requestToken: 0,
  selectedAssetKey: null,
  originalSourceDefinitionExpression: null,
  filteredTargets: []
};

const field = (name) => state.config.fields[name];
const escapeSql = (value) => String(value).replaceAll("'", "''");
const asDate = (value) => value == null ? null : new Date(value);
const fmtTime = (value) => value == null ? "—" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(asDate(value));
const fmtDistance = (metres) => metres >= 1000 ? `${(metres / 1000).toFixed(2)} km` : `${Math.round(metres || 0)} m`;
const rowTime = (feature) => asDate(feature.attributes[field("changeTime")])?.getTime() ?? 0;
const rowOid = (feature) => Number(feature.attributes[field("auditObjectId")] || 0);
const sourceKey = (feature) => String(feature.attributes[field("sourceObjectId")] ?? feature.attributes[field("sourceGlobalId")] ?? "");
const unitKey = (feature) => String(feature.attributes[field("unitId")] ?? sourceKey(feature));

function setNotice(message, kind = "info") {
  ui.notice.kind = kind;
  ui.notice.querySelector("[slot=message]").textContent = message;
  ui.notice.open = true;
}

function localInputValue(date) {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0, 16);
}

function windowBounds() {
  const from = new Date(ui.fromTime.value);
  const to = new Date(ui.toTime.value);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to) {
    throw new Error("Choose a valid time range with From earlier than To.");
  }
  return { from, to };
}

function eventClause() {
  return ui.eventSelect.value ? `${field("eventId")} = '${escapeSql(ui.eventSelect.value)}'` : "1=1";
}

function timestampLiteral(date) {
  return date.toISOString().replace("T", " ").replace("Z", "");
}

async function queryAll(layer, query, pageSize = 1000) {
  const objectIds = await layer.queryObjectIds(query);
  if (!objectIds?.length) return [];
  const rows = [];
  for (let i = 0; i < objectIds.length; i += pageSize) {
    const q = layer.createQuery();
    q.objectIds = objectIds.slice(i, i + pageSize);
    q.outFields = query.outFields || ["*"];
    q.returnGeometry = query.returnGeometry ?? true;
    const result = await layer.queryFeatures(q);
    rows.push(...result.features);
  }
  return rows;
}

function sortedRows(rows) {
  return [...rows].sort((a, b) => rowTime(a) - rowTime(b) || rowOid(a) - rowOid(b));
}

function toLonLat(geometry) {
  if (!geometry || geometry.x == null || geometry.y == null) return null;
  const wkid = geometry.spatialReference?.latestWkid || geometry.spatialReference?.wkid;
  if (wkid === 4326 || wkid === 4269) return [geometry.x, geometry.y];
  if ([3857, 102100, 102113].includes(wkid)) {
    return [geometry.x * 180 / (Math.PI * 6378137), (2 * Math.atan(Math.exp(geometry.y / 6378137)) - Math.PI / 2) * 180 / Math.PI];
  }
  return null;
}

function distanceMetres(a, b) {
  const p = toLonLat(a), q = toLonLat(b);
  if (!p || !q) return null;
  const [lon1, lat1, lon2, lat2] = [p[0], p[1], q[0], q[1]].map((v) => v * Math.PI / 180);
  const dlon = lon2 - lon1, dlat = lat2 - lat1;
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dlon / 2) ** 2;
  return 6371008.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function arrowAngle(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
}

function latestStateAt(rows, cutoff) {
  const latest = new Map();
  for (const feature of rows) {
    if (rowTime(feature) > cutoff.getTime()) break;
    const key = sourceKey(feature);
    if (key) latest.set(key, feature);
  }
  return latest;
}

function popupTemplate(title) {
  return {
    title,
    content: [{ type: "fields", fieldInfos: [
      { fieldName: field("changeType"), label: "Change" },
      { fieldName: field("changeTime"), label: "Change time", format: { dateFormat: "short-date-short-time" } },
      { fieldName: field("eventId"), label: "Event ID" },
      { fieldName: field("unitId"), label: "Unit ID" },
      { fieldName: field("eventAssetId"), label: "Event asset ID" },
      { fieldName: field("unitLocation"), label: "Unit location" },
      { fieldName: field("unitType"), label: "Unit type" },
      { fieldName: field("sourceObjectId"), label: "Source ObjectID" },
      { fieldName: field("sourceGlobalId"), label: "Source GlobalID" },
      { fieldName: field("editorUser"), label: "Editor" },
      { fieldName: field("wfmStatus"), label: "Workflow status" },
      { fieldName: field("wfmJobId"), label: "Workflow job ID" },
      { fieldName: field("wfmAttemptCount"), label: "Workflow attempts" },
      { fieldName: field("wfmCompletedDate"), label: "Workflow completed", format: { dateFormat: "short-date-short-time" } },
      { fieldName: field("wfmLastError"), label: "Workflow error" },
      { fieldName: field("sourceLayerUrl"), label: "Source layer" }
    ] }]
  };
}

function drawAt(cutoff) {
  state.graphics.trails.removeAll();
  state.graphics.positions.removeAll();
  state.graphics.endpoints.removeAll();
  const cutoffMs = cutoff.getTime();
  const byUnit = new Map();
  for (const feature of state.auditRows) {
    if (rowTime(feature) > cutoffMs) break;
    if (state.selectedAssetKey && sourceKey(feature) !== state.selectedAssetKey) continue;
    const key = unitKey(feature);
    if (!key) continue;
    if (!byUnit.has(key)) byUnit.set(key, []);
    byUnit.get(key).push(feature);
  }

  const trailSymbol = { type: "simple-line", color: state.config.playback.trailColor, width: 2 };
  for (const [unitId, rows] of byUnit) {
    let path = [];
    const flush = () => {
      if (path.length < 2) { path = []; return; }
      const last = path[path.length - 1].feature;
      state.graphics.trails.add(new state.Graphic({
        geometry: { type: "polyline", paths: [path.map((p) => [p.x, p.y])], spatialReference: last.geometry.spatialReference },
        attributes: { ...last.attributes, __unitKey: unitId },
        symbol: trailSymbol,
        popupTemplate: popupTemplate(`Unit {${field("unitId")}} trail`)
      }));
      const origin = path[0];
      const originDirection = path.find((point) => point.x !== origin.x || point.y !== origin.y);
      const destination = path[path.length - 1];
      const destinationDirection = [...path].reverse().find((point) => point.x !== destination.x || point.y !== destination.y);
      if (state.userSettings.showMovementEndpoints && originDirection && destinationDirection) {
        state.graphics.endpoints.addMany([
          new state.Graphic({
            geometry: origin.feature.geometry,
            attributes: { ...origin.feature.attributes, __unitKey: unitId, __movementEndpoint: "Origin" },
            symbol: { type: "simple-marker", style: "triangle", color: state.config.playback.originArrowColor, size: 13, angle: arrowAngle(origin, originDirection), outline: { color: "#071824", width: 1.5 } },
            popupTemplate: popupTemplate(`Movement origin — Unit {${field("unitId")}}`)
          }),
          new state.Graphic({
            geometry: destination.feature.geometry,
            attributes: { ...destination.feature.attributes, __unitKey: unitId, __movementEndpoint: "Destination" },
            symbol: { type: "simple-marker", style: "triangle", color: state.config.playback.destinationArrowColor, size: 15, angle: arrowAngle(destinationDirection, destination), outline: { color: "#071824", width: 1.5 } },
            popupTemplate: popupTemplate(`Movement destination — Unit {${field("unitId")}}`)
          })
        ]);
      }
      path = [];
    };
    for (const feature of rows) {
      const type = String(feature.attributes[field("changeType")] || "").toUpperCase();
      if (type === "DELETE") { flush(); continue; }
      if (!feature.geometry || rowTime(feature) < windowBounds().from.getTime()) continue;
      path.push({ x: feature.geometry.x, y: feature.geometry.y, feature });
    }
    flush();
  }

  const marker = { type: "simple-marker", color: state.config.playback.positionColor, size: 9, outline: { color: "white", width: 1 } };
  state.filteredTargets = [];
  for (const feature of latestStateAt(state.auditRows, cutoff).values()) {
    if (state.selectedAssetKey && sourceKey(feature) !== state.selectedAssetKey) continue;
    if (String(feature.attributes[field("changeType")] || "").toUpperCase() === "DELETE" || !feature.geometry) continue;
    state.filteredTargets.push(feature.geometry);
    state.graphics.positions.add(new state.Graphic({
      geometry: feature.geometry,
      attributes: feature.attributes,
      symbol: marker,
      popupTemplate: popupTemplate(`Unit {${field("unitId")}}`)
    }));
  }
  updatePlaybackLabel(cutoff);
}

function movementMetrics(rows, from, to) {
  const priorBySource = new Map();
  let moves = 0, distance = 0, unavailable = 0;
  for (const feature of rows) {
    const key = sourceKey(feature);
    const type = String(feature.attributes[field("changeType")] || "").toUpperCase();
    const prior = priorBySource.get(key);
    const time = rowTime(feature);
    if (type !== "DELETE" && prior?.geometry && feature.geometry && time >= from.getTime() && time <= to.getTime()) {
      const metres = distanceMetres(prior.geometry, feature.geometry);
      if (metres == null) unavailable += 1;
      else if (metres > 0.01) { moves += 1; distance += metres; }
    }
    if (type === "DELETE") priorBySource.delete(key);
    else priorBySource.set(key, feature);
  }
  return { moves, distance, unavailable };
}

function updateKpis(from, to) {
  const inWindow = state.auditRows.filter((f) => rowTime(f) >= from.getTime() && rowTime(f) <= to.getTime());
  const adds = inWindow.filter((f) => String(f.attributes[field("changeType")] || "").toUpperCase() === "ADD").length;
  const deletes = inWindow.filter((f) => String(f.attributes[field("changeType")] || "").toUpperCase() === "DELETE").length;
  const latest = latestStateAt(state.auditRows, to);
  const active = [...latest.values()].filter((f) => String(f.attributes[field("changeType")] || "").toUpperCase() !== "DELETE").length;
  const movement = movementMetrics(state.auditRows, from, to);
  ui.kpiAssets.textContent = active.toLocaleString();
  ui.kpiAdds.textContent = adds.toLocaleString();
  ui.kpiMoves.textContent = movement.moves.toLocaleString();
  ui.kpiDistance.textContent = fmtDistance(movement.distance);
  ui.kpiDeletes.textContent = deletes.toLocaleString();
  return movement;
}

function updateClocks() {
  const now = new Date();
  const options = { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" };
  ui.utcTime.textContent = new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(now);
  ui.pacificTime.textContent = new Intl.DateTimeFormat("en-US", { ...options, timeZone: "America/Los_Angeles" }).format(now);
}

function startClocks() {
  updateClocks();
  window.setInterval(updateClocks, 1000);
}

async function loadAuthenticatedUser(Portal) {
  const username = state.credential?.userId || "Authorized user";
  ui.authFullName.textContent = username;
  ui.authUsername.textContent = username;
  try {
    const portal = new Portal({ url: state.config.portalUrl, authMode: "immediate" });
    await portal.load();
    const user = portal.user;
    ui.authFullName.textContent = user?.fullName || username;
    ui.authUsername.textContent = user?.username || username;
    ui.userIdentity.title = `${user?.fullName || username} (${user?.username || username})`;
  } catch (error) {
    console.warn("ArcGIS user profile could not be loaded", error);
  }
}

async function requireCredential(IdentityManager, sharingUrl) {
  try {
    return await IdentityManager.checkSignInStatus(sharingUrl);
  } catch {
    ui.authScreen.hidden = false;
    ui.appShell.hidden = true;
    return new Promise((resolve) => {
      ui.signInButton.addEventListener("click", async () => {
        ui.authError.textContent = "Signing in…";
        ui.authScreen.setAttribute("aria-busy", "true");
        ui.authLoading.hidden = false;
        ui.signInButton.loading = true;
        ui.signInButton.disabled = true;
        try {
          resolve(await IdentityManager.getCredential(sharingUrl));
        } catch (error) {
          console.error(error);
          ui.authScreen.removeAttribute("aria-busy");
          ui.authLoading.hidden = true;
          ui.signInButton.loading = false;
          ui.signInButton.disabled = false;
          ui.authError.textContent = "Sign-in failed or this account is not authorized. Please try again.";
          ui.signInButton.focus();
        }
      });
    });
  }
}

async function initialize() {
  state.config = await fetch("./config.json", { cache: "no-store" }).then((response) => {
    if (!response.ok) throw new Error(`config.json failed: HTTP ${response.status}`);
    return response.json();
  });
  const [esriConfig, OAuthInfo, IdentityManager, Portal, ArcGISMap, MapView, FeatureLayer, GraphicsLayer, Graphic] = await Promise.all([
    $arcgis.import("@arcgis/core/config.js"),
    $arcgis.import("@arcgis/core/identity/OAuthInfo.js"),
    $arcgis.import("@arcgis/core/identity/IdentityManager.js"),
    $arcgis.import("@arcgis/core/portal/Portal.js"),
    $arcgis.import("@arcgis/core/Map.js"),
    $arcgis.import("@arcgis/core/views/MapView.js"),
    $arcgis.import("@arcgis/core/layers/FeatureLayer.js"),
    $arcgis.import("@arcgis/core/layers/GraphicsLayer.js"),
    $arcgis.import("@arcgis/core/Graphic.js")
  ]);
  esriConfig.portalUrl = state.config.portalUrl;
  state.IdentityManager = IdentityManager;
  if (state.config.oauthAppId) {
    const popup = !/iPhone|iPad|Android/i.test(navigator.userAgent);
    IdentityManager.registerOAuthInfos([new OAuthInfo({
      appId: state.config.oauthAppId,
      portalUrl: state.config.portalUrl,
      popup,
      popupCallbackUrl: state.config.oauthPopupCallbackUrl
    })]);
    const sharingUrl = `${state.config.portalUrl}/sharing`;
    state.credential = await requireCredential(IdentityManager, sharingUrl);
    await loadAuthenticatedUser(Portal);
  }
  ui.authScreen.hidden = true;
  ui.appShell.hidden = false;
  startClocks();
  bindHeaderEvents();
  document.querySelector(".brand-block h1")?.focus();

  state.config.playback.defaultWindowHours = state.userSettings.defaultWindowHours;
  state.config.playback.intervalMs = Number(state.config.playback.intervalMs || 750);
  state.config.refreshIntervalMinutes = state.userSettings.refreshIntervalMinutes;
  ui.speedSlider.value = String(state.userSettings.playbackSpeed);

  state.layers.source = new FeatureLayer({
    portalItem: { id: state.config.source.itemId, portal: { url: state.config.portalUrl } },
    layerId: state.config.source.layerId,
    title: state.config.source.title,
    outFields: ["*"]
  });
  state.layers.audit = new FeatureLayer({ url: state.config.audit.layerUrl, title: state.config.audit.title, outFields: ["*"], listMode: "hide" });
  state.graphics.trails = new GraphicsLayer({ title: "Audit trails (client-derived)" });
  state.graphics.positions = new GraphicsLayer({ title: "Audit playback positions" });
  state.graphics.endpoints = new GraphicsLayer({ title: "Movement origin and destination arrows" });
  const map = new ArcGISMap({ basemap: state.userSettings.basemap, layers: [state.layers.source, state.graphics.trails, state.graphics.positions, state.graphics.endpoints] });
  state.view = new MapView({ container: "viewDiv", map, center: [146.8, -41.2], zoom: 9, popupEnabled: true });
  window.__esriView = state.view;
  window.__esriMap = map;
  window.__esriLayers = state.layers;
  window.__app = state;
  await Promise.all([state.view.when(), state.layers.source.load(), state.layers.audit.load()]);
  state.originalSourceDefinitionExpression = state.layers.source.definitionExpression || null;
  state.Graphic = Graphic;

  const now = new Date();
  ui.toTime.value = localInputValue(now);
  ui.fromTime.value = localInputValue(new Date(now.getTime() - state.config.playback.defaultWindowHours * 3600000));
  bindEvents();
  await loadEvents();
  await refresh();
  const sourceExtent = await state.layers.source.queryExtent({ where: "1=1" }).catch(() => null);
  if (sourceExtent?.extent) state.view.goTo(sourceExtent.extent.expand(1.3)).catch(() => {});
  else if (state.layers.source.fullExtent) state.view.goTo(state.layers.source.fullExtent.expand(1.15)).catch(() => {});
  startAutoRefresh();
}

async function loadEvents() {
  const q = state.layers.audit.createQuery();
  q.where = `${field("eventId")} IS NOT NULL`;
  q.outFields = [field("eventId")];
  q.returnGeometry = false;
  q.returnDistinctValues = true;
  q.orderByFields = [field("eventId")];
  const result = await state.layers.audit.queryFeatures(q);
  for (const id of [...new Set(result.features.map((f) => f.attributes[field("eventId")]).filter((v) => v != null).map(String))].sort()) {
    const option = document.createElement("calcite-option");
    option.value = id;
    option.textContent = id;
    ui.eventSelect.append(option);
  }
}

async function refresh() {
  const token = ++state.requestToken;
  stopPlayback();
  ui.applyButton.loading = true;
  setNotice("Loading ordered audit history…");
  try {
    const { from, to } = windowBounds();
    const q = state.layers.audit.createQuery();
    q.where = `${eventClause()} AND ${field("changeTime")} <= TIMESTAMP '${timestampLiteral(to)}'`;
    q.outFields = ["*"];
    q.returnGeometry = true;
    const rows = sortedRows(await queryAll(state.layers.audit, q));
    if (token !== state.requestToken) return false;
    state.auditRows = rows;
    ui.timeSlider.value = "100";
    drawAt(to);
    const movement = updateKpis(from, to);
    updateAssetList(from, to);
    const warning = movement.unavailable ? ` ${movement.unavailable} movement distances could not be calculated for the audit spatial reference.` : "";
    const cadence = Number(state.config.refreshIntervalMinutes || 5);
    setNotice(`Loaded ${rows.length.toLocaleString()} audit records through the selected end time.${warning} Auto-refreshes every ${cadence} minutes.`, movement.unavailable ? "warning" : "success");
    return true;
  } catch (error) {
    console.error(error);
    setNotice(error.message || String(error), "danger");
    return false;
  } finally {
    ui.applyButton.loading = false;
  }
}

function updatePlaybackLabel(date) {
  ui.playbackLabel.textContent = `Showing reconstructed state at ${fmtTime(date)}`;
}

function playbackCutoff(percent) {
  const { from, to } = windowBounds();
  return new Date(from.getTime() + (to.getTime() - from.getTime()) * (percent / 100));
}

function setPlayback(percent) {
  const cutoff = playbackCutoff(percent);
  drawAt(cutoff);
  return cutoff;
}

function playbackSpeed() {
  return Math.max(0.25, Number(ui.speedSlider.value) || 1);
}

function updateSpeedLabel() {
  ui.speedLabel.textContent = `${playbackSpeed().toLocaleString(undefined, { maximumFractionDigits: 2 })}× speed`;
}

function selectedAssetLabel() {
  if (!state.selectedAssetKey) return null;
  const feature = [...state.auditRows].reverse().find((row) => sourceKey(row) === state.selectedAssetKey);
  return feature?.attributes[field("unitId")] || state.selectedAssetKey;
}

function updatePlaybackScope() {
  const label = selectedAssetLabel();
  ui.playbackScope.textContent = label ? `Playback scope: selected asset ${label}` : "Playback scope: all filtered assets";
  if (!state.timer) ui.playButton.textContent = label ? "Play selected asset" : "Play all assets";
}

function playbackTick() {
  const { from, to } = windowBounds();
  const increment = Math.max(1, 100 * state.config.playback.stepMinutes * 60000 / (to - from));
  const next = Number(ui.timeSlider.value) + increment;
  ui.timeSlider.value = String(Math.min(100, next));
  setPlayback(Math.min(100, next));
  if (next >= 100) stopPlayback();
}

function startPlaybackTimer() {
  if (state.timer) window.clearInterval(state.timer);
  const delay = Math.max(75, Number(state.config.playback.intervalMs || 750) / playbackSpeed());
  state.timer = window.setInterval(playbackTick, delay);
}

function togglePlayback() {
  if (state.timer) return stopPlayback();
  if (Number(ui.timeSlider.value) >= 100) {
    ui.timeSlider.value = "0";
    setPlayback(0);
  }
  ui.playButton.textContent = "Pause";
  ui.playButton.iconStart = "pause";
  startPlaybackTimer();
}

function stopPlayback() {
  if (state.timer) window.clearInterval(state.timer);
  state.timer = null;
  ui.playButton.iconStart = "play";
  updatePlaybackScope();
}

function workflowText(feature) {
  const status = feature.attributes[field("wfmStatus")] || "Not required";
  const jobId = feature.attributes[field("wfmJobId")];
  return jobId ? `${status} • Job ${jobId}` : String(status);
}

function resetToFilteredExtent() {
  if (state.filteredTargets.length) return state.view.goTo(state.filteredTargets, { padding: 70 }).catch(() => {});
  if (state.layers.source.fullExtent) return state.view.goTo(state.layers.source.fullExtent.expand(1.15)).catch(() => {});
}

function clearAssetSelection(resetExtent = true) {
  stopPlayback();
  state.selectedAssetKey = null;
  state.layers.source.definitionExpression = state.originalSourceDefinitionExpression;
  for (const item of ui.assetList.querySelectorAll("calcite-list-item")) item.selected = false;
  ui.assetSummary.textContent = "Select an asset to zoom to it and play only its audited updates and movement.";
  ui.timeline.replaceChildren();
  setPlayback(Number(ui.timeSlider.value));
  updatePlaybackScope();
  if (resetExtent) resetToFilteredExtent();
}

function selectAsset(feature, selectedItem = null) {
  const key = sourceKey(feature);
  if (!key) return;
  if (state.selectedAssetKey === key) return clearAssetSelection(true);
  stopPlayback();
  state.selectedAssetKey = key;
  const rawSourceObjectId = feature.attributes[field("sourceObjectId")];
  const sourceObjectId = rawSourceObjectId == null || rawSourceObjectId === "" ? null : Number(rawSourceObjectId);
  const sourceGlobalId = feature.attributes[field("sourceGlobalId")];
  let selectedSourceClause = "1=0";
  if (sourceObjectId != null && Number.isFinite(sourceObjectId)) {
    selectedSourceClause = `${state.layers.source.objectIdField} = ${sourceObjectId}`;
  } else if (sourceGlobalId && state.layers.source.globalIdField) {
    selectedSourceClause = `${state.layers.source.globalIdField} = '${escapeSql(sourceGlobalId)}'`;
  }
  state.layers.source.definitionExpression = state.originalSourceDefinitionExpression
    ? `(${state.originalSourceDefinitionExpression}) AND (${selectedSourceClause})`
    : selectedSourceClause;
  for (const item of ui.assetList.querySelectorAll("calcite-list-item")) item.selected = item === selectedItem || item.dataset.assetKey === key;
  showTimeline(feature);
  ui.timeSlider.value = "0";
  setPlayback(0);
  updatePlaybackScope();
  if (feature.geometry) state.view.goTo({ target: feature.geometry, zoom: 16 }, { duration: 500 }).catch(() => {});
}

function updateAssetList(from, to) {
  const latest = new Map();
  for (const feature of state.auditRows) {
    const time = rowTime(feature);
    if (time < from.getTime() || time > to.getTime()) continue;
    const key = sourceKey(feature);
    if (key) latest.set(key, feature);
  }
  const rows = [...latest.values()].sort((a, b) => rowTime(b) - rowTime(a) || rowOid(b) - rowOid(a));
  ui.assetList.replaceChildren();
  for (const feature of rows.slice(0, 500)) {
    const key = sourceKey(feature);
    const item = document.createElement("calcite-list-item");
    item.label = `${feature.attributes[field("unitId")] || key} • ${feature.attributes[field("eventId")] || "No event"}`;
    item.description = `${feature.attributes[field("changeType")] || "CHANGE"} • ${fmtTime(feature.attributes[field("changeTime")])} • ${workflowText(feature)}`;
    item.value = key;
    item.dataset.assetKey = key;
    item.selected = state.selectedAssetKey === key;
    item.addEventListener("click", () => selectAsset(feature, item));
    ui.assetList.append(item);
  }
  if (state.selectedAssetKey && !latest.has(state.selectedAssetKey)) clearAssetSelection(false);
}

function showTimeline(feature) {
  const key = sourceKey(feature);
  const unit = feature.attributes[field("unitId")] ?? key;
  ui.assetSummary.textContent = `Playback scoped to Unit ${unit} • source ${key} • ${workflowText(feature)}`;
  ui.timeline.replaceChildren();
  const rows = state.auditRows.filter((row) => sourceKey(row) === key).sort((a, b) => rowTime(b) - rowTime(a) || rowOid(b) - rowOid(a));
  for (const row of rows.slice(0, 200)) {
    const item = document.createElement("calcite-list-item");
    item.label = row.attributes[field("changeType")] || "CHANGE";
    item.description = `${fmtTime(row.attributes[field("changeTime")])} • ${row.attributes[field("unitLocation")] || "No location label"} • ${workflowText(row)}`;
    item.value = String(row.attributes[field("auditObjectId")] || "");
    ui.timeline.append(item);
  }
}

function csvCell(value) {
  if (value == null) return "";
  return `"${String(value).replaceAll('"', '""')}"`;
}

function exportCsv() {
  const { from, to } = windowBounds();
  const rows = state.auditRows.filter((f) => rowTime(f) >= from.getTime() && rowTime(f) <= to.getTime());
  if (!rows.length) return setNotice("There are no audit records in the selected window.", "warning");
  const names = Object.keys(rows[0].attributes);
  const lines = [names.map(csvCell).join(","), ...rows.map((feature) => names.map((name) => csvCell(feature.attributes[name])).join(","))];
  const blob = new Blob(["\uFEFF", lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `pedder-audit-${new Date().toISOString().replaceAll(":", "-")}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function autoRefresh() {
  if (document.visibilityState !== "visible" || state.timer || ui.applyButton.loading) return;
  const cadenceMs = Math.max(1, Number(state.config.refreshIntervalMinutes || 5)) * 60000;
  const previousFromValue = ui.fromTime.value;
  const previousToValue = ui.toTime.value;
  const { from, to } = windowBounds();
  const now = new Date();
  const duration = Math.max(60000, to.getTime() - from.getTime());
  ui.toTime.value = localInputValue(now);
  ui.fromTime.value = localInputValue(new Date(now.getTime() - duration));
  state.layers.source.refresh();
  state.layers.audit.refresh();
  const refreshed = await refresh();
  if (!refreshed) {
    ui.fromTime.value = previousFromValue;
    ui.toTime.value = previousToValue;
    setPlayback(Number(ui.timeSlider.value));
  }
  state.lastAutoRefresh = Date.now();
  return cadenceMs;
}

function startAutoRefresh() {
  const cadenceMs = Math.max(1, Number(state.config.refreshIntervalMinutes || 5)) * 60000;
  if (state.autoRefreshTimer) window.clearInterval(state.autoRefreshTimer);
  state.lastAutoRefresh = Date.now();
  state.autoRefreshTimer = window.setInterval(autoRefresh, cadenceMs);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - state.lastAutoRefresh >= cadenceMs) autoRefresh();
  });
}

function bindHeaderEvents() {
  ui.settingsAction.addEventListener("click", () => { window.location.href = "./settings.html"; });
  ui.signOutAction.addEventListener("click", () => {
    state.IdentityManager?.destroyCredentials();
    window.location.reload();
  });
}

function bindEvents() {
  ui.applyButton.addEventListener("click", refresh);
  ui.refreshAction.addEventListener("click", refresh);
  ui.playButton.addEventListener("click", togglePlayback);
  ui.exportButton.addEventListener("click", exportCsv);
  ui.resetExtentButton.addEventListener("click", () => clearAssetSelection(true));
  ui.timeSlider.addEventListener("input", () => setPlayback(Number(ui.timeSlider.value)));
  ui.speedSlider.addEventListener("input", () => {
    updateSpeedLabel();
    if (state.timer) startPlaybackTimer();
  });
  updateSpeedLabel();
  state.view.on("click", async (event) => {
    const hit = await state.view.hitTest(event, { include: [state.graphics.endpoints, state.graphics.positions, state.graphics.trails] });
    const graphic = hit.results.find((result) => result.graphic)?.graphic;
    if (graphic) selectAsset(graphic);
  });
}

initialize().catch((error) => {
  console.error(error);
  if (ui.appShell.hidden) {
    ui.authScreen.hidden = false;
    ui.authLoading.hidden = true;
    ui.authScreen.removeAttribute("aria-busy");
    ui.signInButton.loading = false;
    ui.signInButton.disabled = false;
    ui.authError.textContent = `The application could not start: ${error.message || String(error)} Reload the page to try again.`;
  } else {
    setNotice(error.message || String(error), "danger");
  }
});
