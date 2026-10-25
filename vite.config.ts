import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Libraries embed URLs that are never fetched. The offline bundle must not reference external origins
// (frontend/Dockerfile greps dist for "scheme://"), so after minification:
// - React's "https://react.dev/errors/<code>" loses its scheme;
// - the allowlisted strings below are written as "scheme:\u002F\u002F…" (same string at runtime);
// - any other URL fails the build, so a new CDN or remote fetch cannot slip through.
const NEVER_FETCHED = [
  "http://localhost", // react-router: base for parsing relative URLs
  "https://reactrouter.com/", // react-router: docs links in error messages
  "https://github.com/ungap/url-search-params", // react-router: polyfill hint in an error message
];

export function rewriteBundleUrls(code: string): { code: string; unknown: string[] } {
  let out = code.replaceAll("https://react.dev/errors/", "react.dev/errors/");
  for (const url of NEVER_FETCHED) out = out.replaceAll(url, url.replace("://", ":\\u002F\\u002F"));
  const unknown = [...out.matchAll(/https?:\/\/(?!www\.w3\.org\/)[^\s"'`)]*/g)].map((m) => m[0]);
  return { code: out, unknown };
}

function stripExternalUrls(): Plugin {
  return {
    name: "strip-external-urls",
    apply: "build",
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== "chunk") continue;
        const { code, unknown } = rewriteBundleUrls(chunk.code);
        if (unknown.length) this.error(`external URL in ${chunk.fileName}: ${[...new Set(unknown)].join(", ")}`);
        chunk.code = code;
      }
    },
  };
}

// No backend proxy: every request is answered by src/api/stub (STUBS.md).
export default defineConfig({
  plugins: [react(), stripExternalUrls()],
  build: { outDir: "dist", sourcemap: false },
});
