// One-time: create the config signing key pair.
//   ~/.drip-private/config-signing-key.jwk → stays on your Mac, outside the repo. Back it up somewhere safe.
//   src/lib/configKey.ts            → public key, built into the app and the Worker.
// Run again only to rotate the key (then release an app with the new public key).
import { existsSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const privateDir = process.env.DRIP_PRIVATE_DIR ?? join(homedir(), ".drip-private");
const priv = join(privateDir, "config-signing-key.jwk");
if (existsSync(priv) && !process.argv.includes("--rotate")) {
  console.error("A signing key already exists. Pass --rotate to replace it.");
  process.exit(1);
}
const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const pubJwk = await crypto.subtle.exportKey("jwk", publicKey);
const privJwk = await crypto.subtle.exportKey("jwk", privateKey);
const kid = new Date().toISOString().slice(0, 10);
mkdirSync(privateDir, { recursive: true, mode: 0o700 });
writeFileSync(priv, JSON.stringify({ ...privJwk, kid }, null, 2));
chmodSync(priv, 0o600);
const { kty, crv, x, y } = pubJwk;
writeFileSync(
  join(root, "src/lib/configKey.ts"),
  `/** Public key that verifies remote config signatures (backend/scripts/keygen.mjs). The private key never leaves the owner's Mac. */\nexport const CONFIG_PUBLIC_KEY = ${JSON.stringify({ kty, crv, x, y, kid }, null, 2)} as const;\n`,
);
console.log("Private key:", priv, "(keep it safe, never commit it)");
console.log("Public key written to src/lib/configKey.ts, kid", kid);
