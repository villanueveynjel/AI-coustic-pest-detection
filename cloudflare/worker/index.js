import { importPKCS8, SignJWT, createRemoteJWKSet, jwtVerify } from 'jose';

const FIREBASE_JWKS = createRemoteJWKSet(new URL(
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'
));
const FCM_TOPIC = 'aicoustic-pest-alerts';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const OAUTH_AUDIENCE = 'https://oauth2.googleapis.com/token';
let cachedGoogleAccessToken = '';
let cachedGoogleAccessTokenExpiry = 0;

function allowedOrigins(env) {
  return new Set(String(env.ALLOWED_ORIGINS || '')
    .split(',').map((origin) => origin.trim()).filter(Boolean));
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = allowedOrigins(env);
  return {
    ...(allowed.has(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function jsonResponse(request, env, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request, env), 'Content-Type': 'application/json; charset=utf-8' }
  });
}

async function getGoogleAccessToken(env) {
  if (cachedGoogleAccessToken && Date.now() < cachedGoogleAccessTokenExpiry - 60_000) {
    return cachedGoogleAccessToken;
  }
  if (!env.FCM_CLIENT_EMAIL || !env.FCM_PRIVATE_KEY || !env.FIREBASE_PROJECT_ID) {
    throw new Error('Worker Firebase credentials are not configured.');
  }

  const privateKey = await importPKCS8(env.FCM_PRIVATE_KEY.replace(/\\n/g, '\n'), 'RS256');
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ scope: FCM_SCOPE })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(env.FCM_CLIENT_EMAIL)
    .setAudience(OAUTH_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey);

  const response = await fetch(OAUTH_AUDIENCE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });
  if (!response.ok) throw new Error(`Google token exchange failed (${response.status}).`);
  const tokenResponse = await response.json();
  cachedGoogleAccessToken = tokenResponse.access_token;
  cachedGoogleAccessTokenExpiry = Date.now() + Number(tokenResponse.expires_in || 3600) * 1000;
  return cachedGoogleAccessToken;
}

async function findDetection(request, env, uid, notificationId) {
  const path = `users/${encodeURIComponent(uid)}/notifications/${encodeURIComponent(notificationId)}`;
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`,
    { headers: { Authorization: request.headers.get('Authorization') } }
  );
  if (!response.ok) return null;

  const document = await response.json();
  const fields = document.fields || {};
  if (fields.type?.stringValue !== 'detection') return null;
  const createdAt = Date.parse(fields.createdAt?.timestampValue || '');
  const age = Date.now() - createdAt;
  if (!Number.isFinite(createdAt) || age < -60_000 || age > 10 * 60_000) return null;

  return {
    title: String(fields.title?.stringValue || 'Pest detected').slice(0, 100),
    body: String(fields.message?.stringValue || 'A pest was detected in the rice field.').slice(0, 240),
    detectionId: String(fields.detectionId?.stringValue || '')
  };
}

async function sendTopicNotification(env, notificationId, detection) {
  const accessToken = await getGoogleAccessToken(env);
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/messages:send`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          topic: FCM_TOPIC,
          notification: { title: detection.title, body: detection.body },
          data: { type: 'detection', notificationId, detectionId: detection.detectionId },
          android: {
            priority: 'HIGH',
            notification: { channel_id: 'pest-alerts', sound: 'default' }
          }
        }
      })
    }
  );
  if (!response.ok) {
    console.error('FCM send failed:', response.status, await response.text());
    throw new Error(`FCM send failed (${response.status}).`);
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (!allowedOrigins(env).has(origin)) {
      return jsonResponse(request, env, { error: 'Origin is not allowed.' }, 403);
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    if (request.method !== 'POST') return jsonResponse(request, env, { error: 'Method not allowed.' }, 405);

    const authorization = request.headers.get('Authorization') || '';
    if (!authorization.startsWith('Bearer ')) return jsonResponse(request, env, { error: 'Sign-in is required.' }, 401);

    try {
      const { payload } = await jwtVerify(authorization.slice(7), FIREBASE_JWKS, {
        algorithms: ['RS256'],
        issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,
        audience: env.FIREBASE_PROJECT_ID
      });
      if (typeof payload.sub !== 'string' || !payload.sub || payload.email_verified !== true) {
        return jsonResponse(request, env, { error: 'A verified account is required.' }, 403);
      }

      const requestBody = await request.json().catch(() => ({}));
      const notificationId = typeof requestBody.notificationId === 'string' ? requestBody.notificationId : '';
      if (!/^[A-Za-z0-9_-]{1,180}$/.test(notificationId)) {
        return jsonResponse(request, env, { error: 'Invalid notification.' }, 400);
      }

      const detection = await findDetection(request, env, payload.sub, notificationId);
      if (!detection) return jsonResponse(request, env, { error: 'Recent detection notification not found.' }, 404);
      await sendTopicNotification(env, notificationId, detection);
      return jsonResponse(request, env, { sent: true });
    } catch (error) {
      console.error('Push worker request failed:', error);
      return jsonResponse(request, env, { error: 'Could not send the device alert.' }, 502);
    }
  }
};
