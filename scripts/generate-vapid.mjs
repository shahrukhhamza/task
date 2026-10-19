// Prints a fresh VAPID key pair for Web Push. Run it with `npm run vapid`.
// Nothing leaves your computer. Keep the private key secret (it only goes into Supabase secrets).
import { webcrypto as crypto } from 'node:crypto';

const b64url = (bytes) => Buffer.from(bytes).toString('base64url');
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
const publicKey = b64url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
const privateKey = (await crypto.subtle.exportKey('jwk', pair.privateKey)).d;

console.log(`
Public key  (safe to share; goes in VITE_VAPID_PUBLIC_KEY and VAPID_PUBLIC_KEY):
${publicKey}

Private key (secret; goes only in VAPID_PRIVATE_KEY on Supabase):
${privateKey}
`);
