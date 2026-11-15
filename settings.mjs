const STORAGE_KEY = "special-event-monitoring.settings.v1";

export const DEFAULT_SETTINGS = Object.freeze({
  defaultWindowHours: 24,
  refreshIntervalMinutes: 5,
  playbackSpeed: 1,
  basemap: "dark-gray-vector",
  showMovementEndpoints: true,
  autoNavigatePlayback: true
});

const BASEMAPS = new Set(["dark-gray-vector", "gray-vector", "streets-vector", "topo-vector", "satellite", "hybrid"]);
const WINDOWS = new Set([6, 12, 24, 48, 168, 720]);
const REFRESH_INTERVALS = new Set([1, 5, 10, 15, 30, 60]);
const PLAYBACK_SPEEDS = new Set([0.25, 0.5, 1, 2, 3, 4]);
const allowedNumber = (value, allowed, fallback) => allowed.has(Number(value)) ? Number(value) : fallback;
const allowedBoolean = (value, fallback) => typeof value === "boolean" ? value : fallback;

export function validateSettings(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  return {
    defaultWindowHours: allowedNumber(source.defaultWindowHours, WINDOWS, DEFAULT_SETTINGS.defaultWindowHours),
    refreshIntervalMinutes: allowedNumber(source.refreshIntervalMinutes, REFRESH_INTERVALS, DEFAULT_SETTINGS.refreshIntervalMinutes),
    playbackSpeed: allowedNumber(source.playbackSpeed, PLAYBACK_SPEEDS, DEFAULT_SETTINGS.playbackSpeed),
    basemap: BASEMAPS.has(source.basemap) ? source.basemap : DEFAULT_SETTINGS.basemap,
    showMovementEndpoints: allowedBoolean(source.showMovementEndpoints, DEFAULT_SETTINGS.showMovementEndpoints),
    autoNavigatePlayback: allowedBoolean(source.autoNavigatePlayback, DEFAULT_SETTINGS.autoNavigatePlayback)
  };
}

export function loadSettings() {
  try {
    return validateSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  const checked = validateSettings(settings);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(checked));
  return checked;
}

export function resetSettings() {
  localStorage.removeItem(STORAGE_KEY);
  return { ...DEFAULT_SETTINGS };
}
