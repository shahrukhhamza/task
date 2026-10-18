// Web Push with nothing but WebCrypto (works in Deno, Node and browsers):
//   * payload encryption: RFC 8291 (aes128gcm content coding, RFC 8188)
//   * sender identification: VAPID, RFC 8292 (ES256-signed JWT)

export interface PushSubscriptionKeys {
  endpoint: string;
  /** Browser's P-256 public key, base64url (65-byte uncompressed point). */
  p256dh: string;
  /** 16-byte auth secret, base64url. */
  auth: string;
}

export interface VapidKeys {
  /** base64url, 65-byte uncompressed P-256 public key. */
  publicKey: string;
  /** base64url, 32-byte private scalar. */
  privateKey: string;
  /** "mailto:you@example.com" or an https URL. */
  subject: string;
}

const enc = new TextEncoder();

export function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function bytesToB64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const concat = (...parts: Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
};

/** WebCrypto wants ArrayBuffer-backed views; this keeps TypeScript and every runtime happy. */
const buf = (u: Uint8Array): ArrayBuffer => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

/** JWK for a P-256 key from its raw uncompressed public point (and optional private scalar). */
function p256Jwk(publicRaw: Uint8Array, privateRaw?: Uint8Array): JsonWebKey {
  return {
    kty: 'EC',
    crv: 'P-256',
    x: bytesToB64url(publicRaw.slice(1, 33)),
    y: bytesToB64url(publicRaw.slice(33, 65)),
    ...(privateRaw ? { d: bytesToB64url(privateRaw) } : {}),
    ext: true,
  };
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', buf(ikm), 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: buf(salt), info: buf(info) }, key, length * 8));
}

export interface EncryptOptions {
  /** Fixed values for tests; random in normal use. */
  salt?: Uint8Array;
  senderPrivate?: Uint8Array;
  senderPublic?: Uint8Array;
}

/** Encrypts one push message body (single record, aes128gcm). */
export async function encryptPayload(sub: Pick<PushSubscriptionKeys, 'p256dh' | 'auth'>, plaintext: Uint8Array, opts: EncryptOptions = {}): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = b64urlToBytes(sub.p256dh);
  const authSecret = b64urlToBytes(sub.auth);

  let senderPrivateKey: CryptoKey;
  let senderPublic: Uint8Array;
  if (opts.senderPrivate && opts.senderPublic) {
    senderPrivateKey = await crypto.subtle.importKey('jwk', p256Jwk(opts.senderPublic, opts.senderPrivate), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
    senderPublic = opts.senderPublic;
  } else {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
    senderPrivateKey = pair.privateKey;
    senderPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  }

  const uaKey = await crypto.subtle.importKey('raw', buf(uaPublic), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, senderPrivateKey, 256));

  // RFC 8291 section 3.4
  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, senderPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  // a single record: content followed by the 0x02 "last record" delimiter
  const record = concat(plaintext, new Uint8Array([2]));
  const aes = await crypto.subtle.importKey('raw', buf(cek), 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(nonce) }, aes, buf(record)));

  // header: salt | record size (uint32) | key id length | key id (sender public key)
  const header = new Uint8Array(16 + 4 + 1 + senderPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = senderPublic.length;
  header.set(senderPublic, 21);
  return concat(header, ciphertext);
}

/** The Authorization header value identifying this server to the push service. */
export async function vapidAuthorization(endpoint: string, vapid: VapidKeys, now = Date.now()): Promise<string> {
  const header = bytesToB64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = bytesToB64url(
    enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: vapid.subject })),
  );
  const key = await crypto.subtle.importKey(
    'jwk',
    p256Jwk(b64urlToBytes(vapid.publicKey), b64urlToBytes(vapid.privateKey)),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  // WebCrypto's ECDSA output is already the raw r||s form JWS needs
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${bytesToB64url(signature)}, k=${vapid.publicKey}`;
}

export type PushOutcome = 'sent' | 'gone' | 'failed';

/** Sends one notification. "gone" means the subscription expired and should be deleted. */
export async function sendPush(
  fetchFn: typeof fetch,
  sub: PushSubscriptionKeys,
  payload: unknown,
  vapid: VapidKeys,
  ttlSeconds = 600,
): Promise<{ outcome: PushOutcome; status: number }> {
  const body = await encryptPayload(sub, enc.encode(JSON.stringify(payload)));
  const res = await fetchFn(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthorization(sub.endpoint, vapid),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(ttlSeconds),
      Urgency: 'high',
    },
    body: buf(body),
  });
  if (res.status === 404 || res.status === 410) return { outcome: 'gone', status: res.status };
  return { outcome: res.ok ? 'sent' : 'failed', status: res.status };
}
