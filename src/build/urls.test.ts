import { describe, expect, it } from "vitest";
import { rewriteBundleUrls } from "../../vite.config";

describe("bundle URL rewrite", () => {
  it("escapes only allowlisted never-fetched URLs and reports any other", () => {
    const r = rewriteBundleUrls('a=`http://localhost`;b="https://react.dev/errors/1";c="https://cdn.example.com/x.js";d="http://www.w3.org/2000/svg"');
    expect(r.code).toContain("http:\\u002F\\u002Flocalhost");
    expect(r.code).toContain("react.dev/errors/1");
    expect(r.code).toContain("http://www.w3.org/2000/svg");
    expect(r.unknown).toEqual(["https://cdn.example.com/x.js"]);
  });
});
