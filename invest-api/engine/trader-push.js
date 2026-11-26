// הצפנה להעברה השעתית מ-IBKR לשרת (invest/docs/TRADER.md). הריפו ציבורי והקלט של workflow_dispatch גלוי — לכן הנתונים עוברים מוצפנים:
// X25519 (מפתח זמני לכל העברה) + HKDF-SHA256 → AES-256-GCM, אחרי דחיסה. המפתח הפרטי נוצר על השרת ולא יוצא ממנו; הציבורי (32 בתים) לא סודי.
// פורמט (base64url): גרסה(1) | מפתח ציבורי זמני(32) | iv(12) | tag(16) | מוצפן
import { generateKeyPairSync, createPublicKey, createPrivateKey, diffieHellman, hkdfSync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';

const INFO = Buffer.from('bikur-trader-push-v1');
const rawPub = (k) => Buffer.from(k.export({ format: 'jwk' }).x, 'base64url');
const pubFromRaw = (b) => createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: Buffer.from(b).toString('base64url') }, format: 'jwk' });
const kdf = (shared, salt) => Buffer.from(hkdfSync('sha256', shared, salt, INFO, 32));

export function keygen(){ const { privateKey } = generateKeyPairSync('x25519'); return privateKey.export({ type: 'pkcs8', format: 'pem' }); }
export function publicKeyOf(privPem){ return rawPub(createPublicKey(createPrivateKey(privPem))).toString('base64url'); }

export function encrypt(obj, pubB64){
  const pub = Buffer.from(String(pubB64).trim(), 'base64url'); if (pub.length !== 32) throw new Error('מפתח ציבורי לא תקין');
  const eph = generateKeyPairSync('x25519'), ephPub = rawPub(eph.publicKey);
  const key = kdf(diffieHellman({ privateKey: eph.privateKey, publicKey: pubFromRaw(pub) }), ephPub), iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv), ct = Buffer.concat([c.update(deflateRawSync(Buffer.from(JSON.stringify(obj)))), c.final()]);
  return Buffer.concat([Buffer.from([1]), ephPub, iv, c.getAuthTag(), ct]).toString('base64url');
}
export function decrypt(b64, privPem, maxBytes = 2e6){
  const b = Buffer.from(String(b64).trim(), 'base64url'); if (b.length < 62 || b[0] !== 1) throw new Error('פורמט לא תקין');
  const ephPub = b.subarray(1, 33), iv = b.subarray(33, 45), tag = b.subarray(45, 61), ct = b.subarray(61);
  const key = kdf(diffieHellman({ privateKey: createPrivateKey(privPem), publicKey: pubFromRaw(ephPub) }), ephPub);
  const d = createDecipheriv('aes-256-gcm', key, iv); d.setAuthTag(tag);
  const plain = inflateRawSync(Buffer.concat([d.update(ct), d.final()]), { maxOutputLength: maxBytes });
  return JSON.parse(plain.toString('utf8'));
}
