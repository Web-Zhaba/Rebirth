import "./style.css";
import { initPlatform } from "./platform";

// The portal's SDK comes up before anything else: the game's texts are fixed at their modules' start, in the language
// the SDK reports (i18n.ts), so the game itself loads only after it.
await initPlatform();
await import("./main");
