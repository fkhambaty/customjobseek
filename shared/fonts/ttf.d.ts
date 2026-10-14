declare module "*.ttf" {
  const bytes: Uint8Array;
  export default bytes;
}

declare module "regenerator-runtime" {
  const runtime: object;
  export default runtime;
}

declare module "node:fs" {
  export function readFileSync(path: string): { toString(encoding: "base64"): string };
}

declare module "@pdf-lib/fontkit/dist/fontkit.es.min.js" {
  interface ResumeFontkit {
    create(buffer: Uint8Array, postscriptName?: string): { characterSet: number[] };
  }
  const fontkit: ResumeFontkit;
  export default fontkit;
}
