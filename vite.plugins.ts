import { readFileSync } from "node:fs";
import type { Plugin } from "vite";

/** Serve .ttf files as bytes, and point fontkit's generator helper at globalThis. */
export function resumeFontPlugins(): Plugin[] {
  return [
    {
      name: "ttf-bytes",
      enforce: "pre",
      load(id) {
        const file = id.split("?")[0] ?? id;
        if (!file.endsWith(".ttf")) return null;
        const encoded = readFileSync(file).toString("base64");
        return `const bytes = Uint8Array.from(atob(${JSON.stringify(encoded)}), (ch) => ch.charCodeAt(0));\nexport default bytes;\n`;
      },
    },
    {
      name: "fontkit-regenerator",
      enforce: "pre",
      transform(code, id) {
        if (!id.includes("fontkit") || !code.includes("regeneratorRuntime")) return null;
        return code.replaceAll("regeneratorRuntime", "globalThis.regeneratorRuntime");
      },
    },
  ];
}
