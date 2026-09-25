/**
 * Generate the Kit program clients from the Anchor IDLs (D-05).
 *
 *   node packages/sdk/scripts/gen-client.mjs            write the clients
 *   node packages/sdk/scripts/gen-client.mjs --check    fail if either would change
 *
 *   idl/tenet.json         -> src/generated          the Tenet program
 *   idl/tenet_devnet.json  -> src/devnet/generated   DEVNET-ONLY test venue,
 *                                                     faucet and price feeds
 *
 * Inputs are COMMITTED copies of the IDLs, because
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
const CLIENTS = [
  { idl: "tenet.json", folder: "src/generated" },
  { idl: "tenet_devnet.json", folder: "src/devnet/generated" },
];
const check = process.argv.includes("--check");

/**
 * Render into `packageDir`/src/generated. `syncPackageJson: false` matters:
 * by default the renderer rewrites the package's dependencies with loose `^`
 * ranges, which would undo the exact pins in packages/sdk/package.json.
 */
async function render(packageDir, client) {
  const idl = JSON.parse(readFileSync(join(pkg, "idl", client.idl), "utf8"));
  const codama = createFromRoot(rootNodeFromAnchor(idl));
  await codama.accept(
    renderVisitor(packageDir, {
      generatedFolder: client.folder,
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

for (const client of CLIENTS) {
  const target = join(pkg, client.folder);
  if (!check) {
    await render(pkg, client);
    console.log(`generated ${files(target).size} files into ${relative(process.cwd(), target) || "."}`);
    continue;
  }
  const tmp = mkdtempSync(join(tmpdir(), "tenet-sdk-"));
  try {
    await render(tmp, client);
    const want = files(join(tmp, client.folder));
    const have = files(target);
    const drift = [...new Set([...want.keys(), ...have.keys()])].filter((k) => want.get(k) !== have.get(k));
    if (drift.length) {
      console.error(`${client.folder} is stale (${drift.length} files differ), e.g. ${drift.slice(0, 5).join(", ")}`);
      console.error("run: node packages/sdk/scripts/gen-client.mjs");
      process.exit(1);
    }
    console.log(`${client.folder} up to date (${want.size} files)`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
