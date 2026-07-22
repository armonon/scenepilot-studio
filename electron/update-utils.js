import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

export function compareVersions(left, right) {
  const leftParts = left.replace(/^v/, "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = right.replace(/^v/, "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function parseSha256(value) {
  const digest = String(value || "").match(/(?:sha256:)?([a-f\d]{64})/i)?.[1];
  return digest?.toLowerCase() ?? null;
}

export function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export async function verifyFileDigest(filePath, expected) {
  const digest = parseSha256(expected);
  return Boolean(digest) && await sha256File(filePath) === digest;
}
