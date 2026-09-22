/**
 * Generate the Kit program client from the Anchor IDL (D-05).
 *
 *   node packages/sdk/scripts/gen-client.mjs            write src/generated
 *   node packages/sdk/scripts/gen-client.mjs --check    fail if it would change
 *
 * Input is packages/sdk/idl/tenet.json — a COMMITTED copy of the IDL, because
 * target/ is deleted to reclaim disk (ENV-01) and the client must be
 * reproducible without a program build. scripts/wsl-build-tenet.sh refreshes
 * the copy after every successful `anchor build`.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createFromRoot } from "codama";
import { rootNodeFromAnchor } from "@codama/nodes-from-anchor";
import { renderVisitor } from "@codama/renderers-js";

const pkg = fileURLToPath(new URL("..", import.meta.url));
const idl = JSON.parse(readFileSync(join(pkg, "idl", "tenet.json"), "utf8"));
const target = join(pkg, "src", "generated");
const generatedIn = (packageDir) => join(packageDir, "src", "generated");
const check = process.argv.includes("--check");

/**
 * Render into `packageDir`/src/generated. `syncPackageJson: false` matters:
 * by default the renderer rewrites the package's dependencies with loose `^`
 * ranges, which would undo the exact pins in packages/sdk/package.json.
 */
async function render(packageDir) {
  const codama = createFromRoot(rootNodeFromAnchor(idl));
  await codama.accept(
    renderVisitor(packageDir, {
      generatedFolder: "src/generated",
      syncPackageJson: false,
      formatCode: false,
      deleteFolderBeforeRendering: true,
    }),
  );
}

function files(dir) {
  const out = new Map();
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else out.set(relative(dir, p).split("\\").join("/"), readFileSync(p, "utf8").replace(/\r\n/g, "\n"));
    }
  };
  walk(dir);
  return out;
}

if (!check) {
  await render(pkg);
  console.log(`generated ${files(target).size} files into ${relative(process.cwd(), target) || "."}`);
} else {
  const tmp = mkdtempSync(join(tmpdir(), "tenet-sdk-"));
  try {
    await render(tmp);
    const want = files(generatedIn(tmp));
    const have = files(target);
    const drift = [...new Set([...want.keys(), ...have.keys()])].filter((k) => want.get(k) !== have.get(k));
    if (drift.length) {
      console.error(`generated client is stale (${drift.length} files differ), e.g. ${drift.slice(0, 5).join(", ")}`);
      console.error("run: node packages/sdk/scripts/gen-client.mjs");
      process.exit(1);
    }
    console.log(`generated client up to date (${want.size} files)`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
