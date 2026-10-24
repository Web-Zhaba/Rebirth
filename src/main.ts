import "./style.css";
import { createMap } from "./map/mapView";

const map = createMap("map");
// Handle for poking at the map from devtools during development.
if (import.meta.env.DEV) Object.assign(window, { map });
