#!/usr/bin/env node
/**
 * host-crop.mjs — upload one local crop to a presigned URL, echo its downloadUrl.
 *
 * The caller mints the URL pair via the `get_upload_url` MCP tool (that call carries the server's
 * secret token and dev URL, which must never live in this repo) and hands the pair here. This helper
 * owns only the PUT: it sets Content-Type, verifies HTTP 200, and prints the downloadUrl to reuse.
 *
 * Presigned upload URLs expire ~300s, so the durable artifact is the crop FILE — re-host from it by
 * minting a fresh pair and calling this again right before each server call, never across a human ask.
 *
 * USAGE:  echo '<json>' | node host-crop.mjs
 *         node host-crop.mjs '<json>'
 * INPUT:  { "crop": "<local png path>", "uploadUrl": "<presigned PUT>", "downloadUrl": "<presigned GET>",
 *           "mimeType"?: "image/png" }
 * OUTPUT: { "downloadUrl": "...", "status": 200 }
 */
import { existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// Uploads go through curl, not Node's fetch: curl honors the sandbox proxy that fetch ignores
// (same reason bundle-from-critique.mjs falls back to curl for downloads).
function putViaCurl(uploadUrl, cropPath, mimeType) {
  let out;
  try {
    out = execFileSync('curl', [
      '-sS', '-o', '/dev/null', '-w', '%{http_code}',
      '--max-time', '60', '-X', 'PUT',
      '-H', `Content-Type: ${mimeType}`,
      '--data-binary', `@${cropPath}`, uploadUrl,
    ], { encoding: 'utf8' });
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error('curl not found — required to upload the crop');
    throw new Error(`crop upload failed: ${String(e.stderr || e.message).trim().slice(0, 200)}`);
  }
  const status = Number(String(out).trim());
  // 403 is the usual expiry signal — a presigned URL that lapsed before the PUT landed.
  if (status !== 200) {
    const hint = status === 403 ? ' (presigned URLs expire ~300s — mint a fresh one and retry)' : '';
    throw new Error(`crop upload failed: HTTP ${status}${hint}`);
  }
  return status;
}

function run(input) {
  const { crop, uploadUrl, downloadUrl, mimeType = 'image/png' } = input;
  if (!crop || !uploadUrl || !downloadUrl) throw new Error('need { crop, uploadUrl, downloadUrl }');
  if (!existsSync(crop) || !statSync(crop).isFile()) throw new Error(`crop file not found: ${crop}`);
  const status = putViaCurl(uploadUrl, crop, mimeType);
  return { downloadUrl, status };
}

async function readStdin() {
  const chunks = [];
  for await (const ch of process.stdin) chunks.push(ch);
  return chunks.join('');
}

const argJson = process.argv[2];
const raw = argJson ?? (await readStdin());
if (!raw || !raw.trim()) {
  process.stderr.write('host-crop.mjs: no input (pass JSON as arg or on stdin)\n');
  process.exit(2);
}
try {
  process.stdout.write(JSON.stringify(run(JSON.parse(raw))) + '\n');
} catch (e) {
  process.stderr.write(`host-crop.mjs: ${e.message}\n`);
  process.exit(1);
}
