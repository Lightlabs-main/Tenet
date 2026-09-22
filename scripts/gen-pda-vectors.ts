/**
 * Regenerate tests/vectors/pda.json from packages/sdk/src/pda.ts.
 *
 *   node scripts/gen-pda-vectors.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { generatePdaVectors, serializePda } from "../packages/sdk/test/pda-vectors.ts";

const v = generatePdaVectors();
mkdirSync(new URL("../tests/vectors/", import.meta.url), { recursive: true });
writeFileSync(new URL("../tests/vectors/pda.json", import.meta.url), serializePda(v));

const fns = new Set(v.vectors.map((x) => x.fn)).size;
console.log(`wrote ${v.vectors.length} PDA vectors across ${fns} derivations`);
