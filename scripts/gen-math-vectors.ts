/**
 * Regenerate tests/vectors/math.json from the TypeScript domain model (U-12).
 *
 *   node scripts/gen-math-vectors.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { generateVectors, serialize } from "../packages/domain/test/vectors.ts";

const vectors = generateVectors();
mkdirSync(new URL("../tests/vectors/", import.meta.url), { recursive: true });
writeFileSync(new URL("../tests/vectors/math.json", import.meta.url), serialize(vectors));

const errs = vectors.filter((v) => v.err).length;
console.log(`wrote ${vectors.length} vectors (${vectors.length - errs} ok, ${errs} error cases)`);
