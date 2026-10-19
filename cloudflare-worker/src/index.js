const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FIREBASE_CERTS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const FCM_TOPIC = 'aicoustic-pest-alerts';
const ALLOWED_ORIGINS = new Set([
  'https://localhost',
  'http://localhost',
  'http://localhost:5173',
  'capacitor://localhost'
]);

let firebaseSigningKeys;
let firebaseSigningKeysExpireAt = 0;
let googleAccessToken = '';
let googleAccessTokenExpiresAt = 0;
let googleAccessTokenRequest;

function base64UrlEncode(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeJwtPart(value) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}

async function getFirebaseSigningKeys() {
  if (firebaseSigningKeys && Date.now() < firebaseSigningKeysExpireAt) return firebaseSigningKeys;
  const response = await fetch(FIREBASE_CERTS_URL, { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!response.ok) throw new Error('Could not load Firebase token verification keys.');
  const jwks = await response.json();
  firebaseSigningKeys = new Map(jwks.keys.map((key) => [key.kid, key]));
  firebaseSigningKeysExpireAt = Date.now() + 50 * 60 * 1000;
  return firebaseSigningKeys;
}

async function verifyFirebaseIdToken(token, projectId) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid sign-in token.');
  const header = decodeJwtPart(parts[0]);
  const claims = decodeJwtPart(parts[1]);
  if (header.alg !== 'RS256' || !header.kid) throw new Error('Invalid sign-in token.');
  const jwk = (await getFirebaseSigningKeys()).get(header.kid);
  if (!jwk) throw new Error('Unknown Firebase signing key.');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const signedValue = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const signature = decodeBase64Url(parts[2]);
  const validSignature = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, signedValue);
  const now = Math.floor(Date.now() / 1000);
  if (!validSignature
    || claims.aud !== projectId
    || claims.iss !== `https://securetoken.google.com/${projectId}`
    || typeof claims.sub !== 'string' || claims.sub.length === 0
    || claims.exp <= now || claims.iat > now + 60) {
    throw new Error('Firebase sign-in token is invalid or expired.');
  }
  return claims;
}

async function createGoogleAccessToken(serviceAccount) {
  if (googleAccessToken && Date.now() < googleAccessTokenExpiresAt - 60_000) {
    return googleAccessToken;
  }
  if (googleAccessTokenRequest) return googleAccessTokenRequest;

  googleAccessTokenRequest = (async () => {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64UrlEncode(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: FCM_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: now,
    exp: now + 3600
  }));
  const unsigned = `${header}.${claim}`;
  const pem = serviceAccount.private_key.replace(/\\n/g, '\n');
  const rawKey = decodeBase64Url(pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, ''));
  const privateKey = await crypto.subtle.importKey(
    'pkcs8', rawKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(unsigned));
  const assertion = `${unsigned}.${base64UrlEncode(new Uint8Array(signature))}`;
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });
  if (!response.ok) throw new Error('Google did not authorize the notification sender.');
  const tokenResponse = await response.json();
  googleAccessToken = tokenResponse.access_token;
  googleAccessTokenExpiresAt = Date.now() + Number(tokenResponse.expires_in || 3600) * 1000;
  return googleAccessToken;
  })();
  try {
    return await googleAccessTokenRequest;
  } finally {
    googleAccessTokenRequest = undefined;
  }
}

function firestoreString(document, field) {
  return document?.fields?.[field]?.stringValue || '';
}

async function verifyDetectionExists(projectId, claims, idToken, notificationId) {
  if (!/^detection_[A-Za-z0-9_-]{1,128}$/.test(notificationId)) return null;
  const path = `users/${encodeURIComponent(claims.sub)}/notifications/${encodeURIComponent(notificationId)}`;
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${path}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
  if (!response.ok) return null;
  const document = await response.json();
  if (firestoreString(document, 'type') !== 'detection') return null;
  const detectionId = firestoreString(document, 'detectionId');
  if (!detectionId || notificationId !== `detection_${detectionId}`) return null;
  return {
    title: firestoreString(document, 'title') || 'Pest detected',
    body: firestoreString(document, 'message') || 'A pest was detected in the rice field.'
  };
}

function jsonResponse(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Vary': 'Origin',
      'Cache-Control': 'no-store'
    }
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (!ALLOWED_ORIGINS.has(origin)) return new Response('Origin not allowed.', { status: 403 });
    if (request.method === 'OPTIONS') return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Vary': 'Origin'
      }
    });
    if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405, origin);

    const url = new URL(request.url);
    if (url.pathname !== '/notify-detection') return jsonResponse({ error: 'Not found.' }, 404, origin);

    const projectId = env.FIREBASE_PROJECT_ID;
    if (!projectId || !env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      return jsonResponse({ error: 'Notification service is not configured.' }, 503, origin);
    }

    try {
      const authorization = request.headers.get('Authorization') || '';
      const idToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
      if (!idToken) return jsonResponse({ error: 'Sign in is required.' }, 401, origin);
      const claims = await verifyFirebaseIdToken(idToken, projectId);
      const body = await request.json();
      const alert = await verifyDetectionExists(projectId, claims, idToken, String(body.notificationId || ''));
      if (!alert) return jsonResponse({ error: 'Detection alert was not found for this account.' }, 404, origin);

      const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
      if (serviceAccount.project_id !== projectId) {
        return jsonResponse({ error: 'Notification credentials belong to a different Firebase project.' }, 503, origin);
      }
      const accessToken = await createGoogleAccessToken(serviceAccount);
      const response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            topic: FCM_TOPIC,
            notification: { title: alert.title, body: alert.body },
            data: { type: 'detection', notificationId: String(body.notificationId) },
            android: {
              priority: 'high',
              notification: { channel_id: 'pest-alerts', sound: 'default' }
            }
          }
        })
      });
      if (!response.ok) {
        console.error('FCM send failed:', response.status, await response.text());
        return jsonResponse({ error: 'FCM could not send the device alert.' }, 502, origin);
      }
      return jsonResponse({ sent: true }, 200, origin);
    } catch (error) {
      console.error('Notification request failed:', error);
      return jsonResponse({ error: 'Could not send the device notification.' }, 500, origin);
    }
  }
};
