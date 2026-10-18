import { describe, expect, it } from 'vitest';
import { b64urlToBytes, bytesToB64url, encryptPayload, sendPush, vapidAuthorization } from '../supabase/functions/_shared/webpush.ts';

// RFC 8291, Appendix A: a complete worked example with fixed keys and salt
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

/** Receiver side of RFC 8291, to prove random-key messages decrypt too. */
async function decrypt(body: Uint8Array<ArrayBuffer>, uaPrivate: string, uaPublic: string, auth: string): Promise<string> {
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const senderPublic = body.slice(21, 21 + idlen);
  const ciphertext = body.slice(21 + idlen);
  const pub = b64urlToBytes(uaPublic);
  const priv = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', x: bytesToB64url(pub.slice(1, 33)), y: bytesToB64url(pub.slice(33)), d: uaPrivate },
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  );
  const senderKey = await crypto.subtle.importKey('raw', senderPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: senderKey }, priv, 256));
  const te = new TextEncoder();
  const hk = async (s: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, len: number) =>
    new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: s, info }, await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), len * 8));
  const ikm = await hk(b64urlToBytes(auth), secret, new Uint8Array([...te.encode('WebPush: info\0'), ...pub, ...senderPublic]), 32);
  const cek = await hk(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hk(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), ciphertext));
  expect(plain[plain.length - 1]).toBe(2);
  return new TextDecoder().decode(plain.slice(0, -1));
}

describe('web push encryption', () => {
  it('matches the RFC 8291 test vector byte for byte', async () => {
    const body = await encryptPayload({ p256dh: RFC.uaPublic, auth: RFC.auth }, new TextEncoder().encode(RFC.plaintext), {
      salt: b64urlToBytes(RFC.salt),
      senderPrivate: b64urlToBytes(RFC.asPrivate),
      senderPublic: b64urlToBytes(RFC.asPublic),
    });
    expect(bytesToB64url(body)).toBe(RFC.body);
  });

  it('round-trips with a fresh random key', async () => {
    const body = await encryptPayload({ p256dh: RFC.uaPublic, auth: RFC.auth }, new TextEncoder().encode('{"title":"Up next: Gym"}'));
    expect(await decrypt(body, RFC.uaPrivate, RFC.uaPublic, RFC.auth)).toBe('{"title":"Up next: Gym"}');
  });
});

describe('VAPID', () => {
  it('signs a JWT the public key verifies, scoped to the push service origin', async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
    const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    const vapid = { publicKey: bytesToB64url(publicRaw), privateKey: jwk.d as string, subject: 'mailto:me@example.com' };

    const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', vapid, Date.UTC(2026, 9, 19));
    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
    expect(match).not.toBeNull();
    const [, h, c, sig, k] = match!;
    expect(k).toBe(vapid.publicKey);
    const claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(c)));
    expect(claims).toEqual({ aud: 'https://fcm.googleapis.com', exp: Date.UTC(2026, 9, 19) / 1000 + 12 * 3600, sub: 'mailto:me@example.com' });
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, b64urlToBytes(sig), new TextEncoder().encode(`${h}.${c}`));
    expect(ok).toBe(true);
  });
});

describe('sendPush', () => {
  const vapidFor = async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'])) as CryptoKeyPair;
    return {
      publicKey: bytesToB64url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))),
      privateKey: (await crypto.subtle.exportKey('jwk', pair.privateKey)).d as string,
      subject: 'mailto:me@example.com',
    };
  };
  const sub = { endpoint: 'https://push.example/abc', p256dh: RFC.uaPublic, auth: RFC.auth };

  it('posts an encrypted body with the right headers', async () => {
    let seen: { headers: Record<string, string>; body: Uint8Array<ArrayBuffer> } | undefined;
    const fetchFn = (async (_url: string, init: RequestInit) => {
      seen = { headers: init.headers as Record<string, string>, body: new Uint8Array(init.body as ArrayBuffer) as Uint8Array<ArrayBuffer> };
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;
    const res = await sendPush(fetchFn, sub, { title: 'Up next' }, await vapidFor());
    expect(res).toEqual({ outcome: 'sent', status: 201 });
    expect(seen?.headers['Content-Encoding']).toBe('aes128gcm');
    expect(seen?.headers.TTL).toBe('600');
    expect(await decrypt(seen!.body, RFC.uaPrivate, RFC.uaPublic, RFC.auth)).toBe('{"title":"Up next"}');
  });

  it('reports expired subscriptions as gone', async () => {
    const fetchFn = (async () => new Response(null, { status: 410 })) as unknown as typeof fetch;
    expect((await sendPush(fetchFn, sub, {}, await vapidFor())).outcome).toBe('gone');
  });
});
