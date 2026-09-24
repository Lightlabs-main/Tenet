import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadVerificationEnv } from "./verification-env.ts";

test("loads selected deployment env first and preserves exported values", () => {
  const root = mkdtempSync(join(tmpdir(), "tenet-verify-env-"));

  try {
    writeFileSync(
      join(root, "deployment.env"),
      [
        "# deployment credentials are never interpreted as shell",
        "DEPLOYMENT_ONLY=from-deployment",
        "SHARED=from-deployment",
        "QUOTED='plain value'",
        "LITERAL=$SHARED",
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(root, ".env"),
      ["SHARED=from-project", "PROJECT_ONLY=from-project", ""].join("\n"),
    );

    const env: Record<string, string | undefined> = {
      TENET_ENV_FILE: "deployment.env",
      SHARED: "from-process",
    };
    loadVerificationEnv({ cwd: root, env });

    assert.equal(env.DEPLOYMENT_ONLY, "from-deployment");
    assert.equal(env.SHARED, "from-process");
    assert.equal(env.PROJECT_ONLY, "from-project");
    assert.equal(env.QUOTED, "plain value");
    assert.equal(env.LITERAL, "$SHARED");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("uses checkout .env when no deployment env file is selected", () => {
  const root = mkdtempSync(join(tmpdir(), "tenet-verify-env-"));

  try {
    writeFileSync(join(root, ".env"), "CHECKOUT_ONLY=loaded\n");
    const env: Record<string, string | undefined> = {};
    loadVerificationEnv({ cwd: root, env });
    assert.equal(env.CHECKOUT_ONLY, "loaded");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
