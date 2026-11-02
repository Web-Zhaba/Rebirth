// WGSL modules: plain .wgsl files imported with `?raw`, composed with `#include "name"` lines. Each include is
// expanded once per module, so shared structs can be included from several chunks safely.

const chunks = new Map<string, string>();

export function registerWgsl(name: string, code: string): void {
  chunks.set(name, code);
}

export function composeWgsl(code: string, defines: Record<string, string | number> = {}, seen = new Set<string>()): string {
  let out = code.replace(/^[ \t]*#include\s+"([\w/.-]+)"[ \t]*$/gm, (_, name: string) => {
    if (seen.has(name)) return "";
    seen.add(name);
    const c = chunks.get(name);
    if (c === undefined) throw new Error(`WGSL include not registered: ${name}`);
    return composeWgsl(c, {}, seen);
  });
  // `${NAME}` placeholders for compile-time constants the TS side owns (grid size and the like).
  for (const [k, v] of Object.entries(defines)) out = out.replaceAll(`\${${k}}`, String(v));
  return out;
}

// Create a module and surface compile errors with their line, which Chrome otherwise only prints as a warning.
export function createShader(device: GPUDevice, label: string, code: string, defines: Record<string, string | number> = {}): GPUShaderModule {
  const src = composeWgsl(code, defines);
  const module = device.createShaderModule({ label, code: src });
  void module.getCompilationInfo().then((info) => {
    const lines = src.split("\n");
    for (const m of info.messages) {
      if (m.type === "info") continue;
      const text = `[engine] WGSL ${m.type} in ${label}:${m.lineNum}:${m.linePos} ${m.message}\n  ${lines[m.lineNum - 1] ?? ""}`;
      if (m.type === "error") console.error(text);
      else console.warn(text);
    }
  });
  return module;
}
