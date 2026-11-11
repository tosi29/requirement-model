import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { build } from "esbuild";

const outfile = "src/reqmodel/presentation/site_bundle.js";
const result = await build({
  entryPoints: ["src/reqmodel/presentation/site_app.ts"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2022"],
  write: false,
  legalComments: "none",
});
const bundle = new TextDecoder().decode(result.outputFiles[0].contents);
if (process.argv.includes("--check")) {
  assert.equal(await readFile(outfile, "utf8"), bundle, `${outfile} is stale; run npm run build`);
} else {
  await writeFile(outfile, bundle);
}
