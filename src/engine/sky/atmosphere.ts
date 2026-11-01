import { registerWgsl } from "../gpu/wgsl";
import atmosphereWgsl from "./atmosphere.wgsl?raw";

// Registers the shared atmosphere chunk; import for its side effect from any module whose WGSL includes it.
registerWgsl("atmosphere", atmosphereWgsl);
