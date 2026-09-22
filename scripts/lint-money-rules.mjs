#!/usr/bin/env node
/**
 * Tenet - mechanical enforcement of the rules that are easy to violate by accident.
 *
 *   node scripts/lint-money-rules.mjs
 *
 * Covers:
 *   RULE 1  no fabricated runtime data (placeholder/sample markers in shipped code)
 *   RULE 4  no float for money; no `res.json()` (V-018 - silently corrupts u64 > 2^53)
 *   spec 6  no ownership language for PreStocks
 *   spec 63 no banned marketing claims
 *   R-03    `overflow-checks` must be on in the Rust release profile
 *
 * Escape hatch: append `// money-lint: allow <reason>` on the offending line.
 * The reason is mandatory - an unexplained suppression is itself a failure.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const SKIP_DIRS = new Set([
  "node_modules", ".git", "target", "dist", ".next", ".anchor",
  "test-ledger", "docs", ".claude",
]);
const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|rs)$/;

/** Files that are allowed to *describe* the rules rather than obey them. */
const SELF_REFERENTIAL = new Set(["scripts/lint-money-rules.mjs"]);

const RULES = [
  {
    id: "V-018/res.json",
    // .json() on a fetch Response loses precision on u64 > 2^53.
    re: /\.json\(\)/,
    msg: "`.json()` corrupts u64 values above 2^53 (V-018). Use parseJsonExact/fetchJsonExact.",
    ext: /\.(ts|tsx|js|mjs|cjs)$/,
  },
  {
    id: "RULE-4/parseFloat",
    re: /\bparseFloat\s*\(/,
    msg: "parseFloat is float arithmetic. Use bigint or an exact decimal type.",
    ext: /\.(ts|tsx|js|mjs|cjs)$/,
  },
  {
    id: "RULE-4/float-money",
    re: /\bNumber\s*\(\s*[^)]*(amount|supply|price|balance|shares|nav|fee|usdc|lamports|multiplier)/i,
    msg: "Number() on a money/quantity field. Use bigint or an exact decimal type.",
    ext: /\.(ts|tsx|js|mjs|cjs)$/,
  },
  {
    id: "SPEC-6/ownership-language",
    re: /\bown(?:s|ing)?\s+(?:OpenAI|SpaceX|Anthropic|Neuralink|Anduril|Kalshi|Polymarket|Figure\s?AI)\b/i,
    msg: "PreStocks conveys economic exposure, not ownership. Say 'X economic exposure'.",
  },
  {
    // "SpaceX shares" / "OpenAI shares" implies shareholder rights we have not
    // verified the product conveys. Also catches "a slice of SpaceX".
    id: "SPEC-4/shareholder-language",
    re: /\b(?:OpenAI|SpaceX|Anthropic|Neuralink|Anduril|Kalshi|Polymarket|Figure\s?AI)\s+(?:shares?|stock|equity)\b|\bslice\s+of\s+(?:OpenAI|SpaceX|Anthropic)\b/i,
    msg: "Implies shareholder rights. Use 'X economic exposure' / 'PreStocks exposure'.",
  },
  {
    // V-023: Partial verification lowers the guardian-collusion threshold needed
    // to forge a price update. Tenet uses the Full-verification default only.
    id: "V-023/pyth-verification-level",
    re: /get_price_no_older_than_with_custom_verification_level|get_price_unchecked|get_twap_unchecked/,
    msg: "Use get_price_no_older_than (VerificationLevel::Full). Partial verification is a forged-price path (R-04).",
  },
  {
    id: "SPEC-63/banned-claims",
    re: /\b(guaranteed\s+return|risk[-\s]?free|zero\s+slippage|perfectly\s+liquid|no\s+tax\s+event|guaranteed\s+exit\s+liquidity)\b/i,
    msg: "Banned claim (spec 63). Use precise language.",
  },
  {
    id: "RULE-1/fake-data",
    re: /\b(MOCK_|FAKE_|DUMMY_|SAMPLE_|PLACEHOLDER_|TODO_FAKE)/,
    msg: "Fabricated runtime data marker. Test fixtures belong in tests/ only.",
  },
];

const violations = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) { walk(full); continue; }
    if (!CODE_EXT.test(entry)) continue;

    const rel = relative(ROOT, full).split(sep).join("/");
    if (SELF_REFERENTIAL.has(rel)) continue;
    // Tests may legitimately construct fixtures.
    const isTest = rel.startsWith("tests/") || /\.(test|spec)\./.test(entry);

    const lines = readFileSync(full, "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      if (/\/\/\s*money-lint:\s*allow\s+\S/.test(line)) return;
      // Comment lines describe the rules; they do not execute them. Prose about
      // a banned construct must not be a violation of it.
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") ||
          trimmed.startsWith("/*") || trimmed.startsWith("#")) return;
      for (const rule of RULES) {
        if (rule.ext && !rule.ext.test(entry)) continue;
        if (isTest && rule.id === "RULE-1/fake-data") continue;
        if (rule.re.test(line)) {
          violations.push({ file: rel, line: i + 1, rule: rule.id, msg: rule.msg, text: line.trim().slice(0, 100) });
        }
      }
    });
  }
}

walk(ROOT);

// R-03: overflow-checks must be enabled in the release profile once Rust exists.
const cargoTomls = [];
(function findCargo(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let st; try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) findCargo(full);
    else if (entry === "Cargo.toml" && relative(ROOT, full).split(sep)[0] !== "target") cargoTomls.push(full);
  }
})(ROOT);

/**
 * The key/value lines of exactly one TOML table, comments stripped. Stops at the
 * next table header, so `[profile.release.build-override]` or `[profile.dev]`
 * cannot satisfy a check meant for `[profile.release]`.
 */
function tomlSection(text, header) {
  const out = [];
  let inside = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const h = /^\[\s*([^\]]+?)\s*\]$/.exec(line);
    if (h) { inside = h[1] === header; continue; }
    if (inside && line) out.push(line);
  }
  return out;
}

if (cargoTomls.length) {
  // Cargo reads profiles ONLY from the workspace root. A [profile.*] in a member
  // manifest is ignored (with a warning that is easy to miss), so it must never
  // be what we rely on.
  const rootCargo = join(ROOT, "Cargo.toml");
  const rootText = existsSync(rootCargo) ? readFileSync(rootCargo, "utf8") : "";
  const release = tomlSection(rootText, "profile.release");
  if (!release.some((l) => /^overflow-checks\s*=\s*true$/.test(l))) {
    violations.push({
      file: "Cargo.toml",
      line: 0,
      rule: "R-03/overflow-checks",
      msg: "workspace-root [profile.release] must set overflow-checks = true. It is OFF by default " +
        "in release, which is how the on-chain .so is built, so u64 arithmetic would wrap silently.",
      text: "(workspace manifest)",
    });
  }
  for (const p of cargoTomls) {
    if (p === rootCargo) continue;
    const t = readFileSync(p, "utf8");
    const idx = t.split(/\r?\n/).findIndex((l) => /^\s*\[\s*profile\./.test(l));
    if (idx >= 0) {
      violations.push({
        file: relative(ROOT, p).split(sep).join("/"),
        line: idx + 1,
        rule: "R-03/overflow-checks",
        msg: "[profile.*] in a workspace member is ignored by cargo. Put it in the root Cargo.toml.",
        text: t.split(/\r?\n/)[idx].trim(),
      });
    }
  }
}

if (violations.length === 0) {
  console.log("money-lint: clean");
  process.exit(0);
}
console.error(`money-lint: ${violations.length} violation(s)\n`);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  [${v.rule}]`);
  console.error(`    ${v.msg}`);
  console.error(`    > ${v.text}\n`);
}
process.exit(1);
