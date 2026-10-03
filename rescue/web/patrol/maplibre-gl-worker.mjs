// In-scope copy of the MapLibre worker entry: Chrome serves a dedicated worker from the service worker only when the
// worker URL is inside the SW scope (./), so ../vendor/maplibre-gl-worker.mjs would fail offline. Imports stay in vendor/.
import "../vendor/maplibre-gl-worker.mjs";
