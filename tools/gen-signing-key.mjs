// Generates the ECDSA P-256 keypair that signs update manifests.
// Run LOCALLY once:  node tools/gen-signing-key.mjs
//
//   • Paste the PUBLIC key into src/updater.js (UPDATE_PUBLIC_KEY_SPKI_B64)
//     and commit it. This turns on signature enforcement for every client
//     already on that version.
//   • Store the PRIVATE key as the GitHub Actions secret
//     CUC_UPDATE_SIGNING_KEY (repo → Settings → Secrets and variables →
//     Actions). NEVER commit it — anyone with it can sign updates.
//
// After that, the publish-update-manifest workflow signs every release, and
// clients refuse any update whose signature doesn't verify. Losing the
// private key just means generating a new pair and shipping a new public key.
import { webcrypto } from "node:crypto";

const { subtle } = webcrypto;
const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const publicKey = Buffer.from(await subtle.exportKey("spki", pair.publicKey)).toString("base64");
const privateKey = Buffer.from(await subtle.exportKey("pkcs8", pair.privateKey)).toString("base64");

console.log("\n=== PUBLIC KEY — paste into src/updater.js UPDATE_PUBLIC_KEY_SPKI_B64, then commit ===\n");
console.log(publicKey);
console.log("\n=== PRIVATE KEY — store as GitHub Actions secret CUC_UPDATE_SIGNING_KEY, never commit ===\n");
console.log(privateKey);
console.log("");
