import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { compareVersions, parseSha256, verifyFileDigest } from "../electron/update-utils.js";

test("desktop update versions compare numerically", () => {
  assert.equal(compareVersions("0.1.10", "0.1.9"), 1);
  assert.equal(compareVersions("v1.2", "1.2.0"), 0);
  assert.equal(compareVersions("1.1.9", "1.2.0"), -1);
});

test("desktop updater accepts only a matching SHA-256", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "scenepilot-update-"));
  const file = path.join(directory, "update.dmg");
  try {
    await writeFile(file, "verified ScenePilot update");
    const digest = createHash("sha256").update("verified ScenePilot update").digest("hex");
    assert.equal(parseSha256(`sha256:${digest}`), digest);
    assert.equal(await verifyFileDigest(file, digest), true);
    assert.equal(await verifyFileDigest(file, "0".repeat(64)), false);
    assert.equal(await verifyFileDigest(file, "not-a-checksum"), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
