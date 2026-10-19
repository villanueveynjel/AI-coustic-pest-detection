import { initializeApp } from 'firebase/app';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { LocalNotifications } from '@capacitor/local-notifications';
import { PushNotifications } from '@capacitor/push-notifications';
import { Capacitor, registerPlugin } from '@capacitor/core';
import {
  createUserWithEmailAndPassword,
  indexedDBLocalPersistence,
  getAuth,
  GoogleAuthProvider,
  getRedirectResult,
  initializeAuth,
  onAuthStateChanged,
  reload,
  sendPasswordResetEmail,
  sendEmailVerification,
  signInWithPopup,
  signInWithCredential,
  signInWithRedirect,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  confirmPasswordReset,
  verifyPasswordResetCode
} from 'firebase/auth';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getFirestore,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  writeBatch
} from 'firebase/firestore';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};
const pushWorkerUrl = import.meta.env.VITE_PUSH_WORKER_URL || '';

const isConfigured = Object.values(config).every((value) => value && !value.startsWith('replace-me') && !value.startsWith('your-project'));
const NativePushTopics = registerPlugin('CurrentWifi');
const demoKey = 'aicoustic-prototype-data-v1';
const demoState = () => {
  try { return JSON.parse(localStorage.getItem(demoKey)) || { detections: [], operations: {}, logs: [], notifications: [] }; }
  catch { return { detections: [], operations: {}, logs: [], notifications: [] }; }
};
const saveDemo = (state) => localStorage.setItem(demoKey, JSON.stringify(state));
const notifyDemoWatchers = () => window.dispatchEvent(new CustomEvent('aicoustic:demo-data-changed'));
const userCacheKey = (uid, type) => `aicoustic:${type}:${uid}`;
function readUserCache(uid, type) {
  try {
    const records = JSON.parse(localStorage.getItem(userCacheKey(uid, type)) || '[]');
    return Array.isArray(records) ? records : [];
  } catch { return []; }
}
function saveUserCache(uid, type, records) {
  try {
    const serializable = records.map((record) => {
      const copy = { ...record };
      for (const field of ['detectedAt', 'createdAt', 'updatedAt', 'readAt']) {
        if (copy[field]?.toDate) copy[field] = copy[field].toDate().toISOString();
      }
      return copy;
    });
    localStorage.setItem(userCacheKey(uid, type), JSON.stringify(serializable));
  } catch (error) {
    console.warn(`Could not cache ${type} for quicker page loading:`, error);
  }
}

let app;
let auth;
let db;
if (isConfigured) {
  app = initializeApp(config);
  // Firebase's web redirect flow loses its state in Android WebViews. Keep
  // the JS SDK session in IndexedDB and use the native Google flow on Android.
  auth = Capacitor.isNativePlatform()
    ? initializeAuth(app, { persistence: indexedDBLocalPersistence })
    : getAuth(app);
  db = getFirestore(app);
}

const signupVerificationUrl = () => new URL('login.html?verified=1', window.location.href).toString();
const passwordResetUrl = () => new URL('reset%20password.html', window.location.href).toString();
const clearSignupVerification = () => {
  sessionStorage.removeItem('aicoustic-signup-verification');
  sessionStorage.removeItem('aicoustic-signup-email');
};

let currentUser = null;
let currentNotifications = [];
let radarResetTimer = null;
let pushRegistrationUserId = null;
const scheduledNativeAlertKeys = new Set();
const userCollection = (name) => collection(db, 'users', currentUser.uid, name);
const localDate = (value) => {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  return date.toISOString();
};

async function sendDetectionPushToDevices(notificationId) {
  if (!pushWorkerUrl || !auth?.currentUser) {
    console.warn('Device push was not sent: the Cloudflare Worker URL or signed-in user is missing.');
    return;
  }
  try {
    const idToken = await auth.currentUser.getIdToken();
    const response = await fetch(pushWorkerUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ notificationId })
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new Error(detail.error || `Cloudflare Worker returned HTTP ${response.status}.`);
    }
  } catch (error) {
    console.error('Could not send the detection alert to other devices:', error);
  }
}

function formatDetectionRow(record, id = '') {
  const pest = String(record.pest || 'Unknown');
  const date = record.detectedAt?.toDate ? record.detectedAt.toDate() : new Date(record.detectedAt || record.createdAt || Date.now());
  const row = document.createElement('article');
  const className = pest.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  row.className = 'detection-row';
  row.dataset.pest = pest;
  row.dataset.date = localDate(date);
  if (id) row.dataset.id = id;
  const avatar = document.createElement('span');
  avatar.className = `pest-avatar ${className}`;
  avatar.textContent = pest.charAt(0).toUpperCase();
  const name = document.createElement('div');
  name.className = 'detection-name';
  const title = document.createElement('strong');
  title.textContent = pest;
  const dateText = document.createElement('small');
  dateText.textContent = `${date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}  |  ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  name.append(title, dateText);
  const action = document.createElement('span');
  action.className = `action-pill ${pest.toLowerCase().includes('cricket') ? 'repellant cricket' : 'speaker'}`;
  action.textContent = pest.toLowerCase().includes('cricket') ? 'Repellent ON' : 'Speaker ON';
  row.append(avatar, name, action);
  return row;
}

function paintDetections(records) {
  const list = document.querySelector('#detection-list');
  if (list) {
    list.replaceChildren();
    if (!records.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-history';
      empty.textContent = 'No detections recorded yet.';
      list.append(empty);
    } else records.forEach(({ id, ...record }) => list.append(formatDetectionRow(record, id)));
  }
  const total = document.querySelector('#detection-total');
  if (total) total.textContent = String(records.length);
  const last = document.querySelector('.last-detected strong');
  if (last) last.textContent = records[0]?.pest || '—';

  const inputAlert = document.querySelector('.dashboard .alert-card');
  const radar = document.querySelector('.field-map');
  if (radar) {
    const latest = records[0];
    const latestTime = latest?.detectedAt?.toDate
      ? latest.detectedAt.toDate().getTime()
      : new Date(latest?.detectedAt || latest?.createdAt || 0).getTime();
    const elapsed = Date.now() - latestTime;
    const hasRecentDetection = Boolean(latest && Number.isFinite(latestTime) && elapsed >= 0);
    const redDuration = 10 * 1000;
    const yellowDuration = 5 * 1000;
    const state = !hasRecentDetection || elapsed >= redDuration + yellowDuration
      ? 'green'
      : elapsed < redDuration ? 'red' : 'yellow';
    radar.classList.toggle('pest-detected', state === 'red');
    radar.classList.toggle('pest-cooldown', state === 'yellow');
    radar.setAttribute('aria-label', state === 'red'
      ? `Pest detected: ${latest.pest}`
      : state === 'yellow' ? 'No new pest detected; radar is returning to green' : 'No pest detected');
    const status = radar.querySelector('.radar-live-status');
    if (status) status.textContent = state === 'red'
      ? `${latest.pest} detected`
      : state === 'yellow' ? 'No new pest detected; radar is returning to green' : 'No pest detected';
    clearTimeout(radarResetTimer);
    if (hasRecentDetection && state === 'red') {
      radarResetTimer = setTimeout(() => paintDetections(records), redDuration - elapsed);
    } else if (hasRecentDetection && state === 'yellow') {
      radarResetTimer = setTimeout(() => paintDetections(records), redDuration + yellowDuration - elapsed);
    }
  }
  if (inputAlert) {
    const heading = inputAlert.querySelector('p strong');
    const detail = inputAlert.querySelector('p small');
    const latest = records[0];
    if (heading) heading.textContent = latest ? `${latest.pest} detected` : 'No pest detected';
    if (detail) detail.textContent = latest ? 'Latest detection received in real time' : 'MEMS microphone is operating normally';
  }
  document.dispatchEvent(new CustomEvent('aicoustic:detections-updated'));
}

function paintNotifications(records) {
  currentNotifications = records;
  const menu = document.querySelector('#notification-menu');
  if (!menu) return;
  const dot = document.querySelector('.notification-dot');
  menu.querySelectorAll('.notification-item, .notification-read-state').forEach((node) => node.remove());
  const unread = records.some((item) => item.type === 'detection' && !item.read);
  if (dot) dot.hidden = !unread;
  if (!records.length) {
    const empty = document.createElement('p');
    empty.className = 'notification-read-state';
    empty.textContent = 'No notifications yet.';
    menu.append(empty);
  }
  records.forEach((record) => {
    const item = document.createElement('p');
    item.className = 'notification-item';
    const title = document.createElement('strong');
    title.textContent = record.title || 'System update';
    const body = document.createElement('small');
    body.textContent = record.message || '';
    item.append(title, body);
    menu.append(item);
  });
}

function showRealtimeToast(record, eventId = '') {
  if (record.type === 'detection' && localStorage.getItem('notify-detection') === 'false') return;
  let toast = document.querySelector('.realtime-notification-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'realtime-notification-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.append(toast);
  }
  if (eventId && toast.dataset.eventId === eventId && !toast.hidden) return;
  toast.dataset.eventId = eventId;
  const title = document.createElement('strong');
  title.textContent = record.title || 'Pest detected';
  const message = document.createElement('span');
  message.textContent = record.message || 'A new monitoring alert was received.';
  toast.replaceChildren(title, message);
  toast.hidden = false;
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => { toast.hidden = true; }, 5000);
}

async function showDeviceNotification({ id, title, body, type = 'detection' }) {
  if (!Capacitor.isNativePlatform()) return;
  if (type === 'detection' && localStorage.getItem('notify-detection') === 'false') return;
  const key = `${type}:${id || `${title}:${body}`}`;
  if (scheduledNativeAlertKeys.has(key)) return;
  scheduledNativeAlertKeys.add(key);
  const notificationId = Math.abs([...key].reduce((hash, character) => ((hash * 31) + character.charCodeAt(0)) | 0, 0)) || Date.now();
  try {
    await LocalNotifications.schedule({ notifications: [{
      id: notificationId,
      title: title || 'Rice field alert',
      body: body || 'A new monitoring alert was received.',
      schedule: { at: new Date(Date.now() + 100) },
      channelId: 'pest-alerts',
      extra: { notificationId: id || '' }
    }] });
  } catch (error) {
    scheduledNativeAlertKeys.delete(key);
    console.error('Could not show the device notification:', error);
  }
}

async function registerDevicePush(user) {
  if (!Capacitor.isNativePlatform() || !user?.uid) return;
  try {
    const permission = await PushNotifications.checkPermissions();
    const result = permission.receive === 'granted' ? permission : await PushNotifications.requestPermissions();
    if (result.receive !== 'granted') return;

    await PushNotifications.createChannel({
      id: 'pest-alerts',
      name: 'Pest detection alerts',
      description: 'Alerts when a pest is detected in the rice field.',
      importance: 5,
      vibration: true
    }).catch((error) => console.warn('Could not create the pest alert channel:', error));

    await PushNotifications.addListener('registration', async () => {
      if (auth.currentUser?.uid !== user.uid) return;
      const alertsEnabled = localStorage.getItem('notify-detection') !== 'false';
      await NativePushTopics[alertsEnabled ? 'subscribePestAlerts' : 'unsubscribePestAlerts']();
      pushRegistrationUserId = user.uid;
    });
    await PushNotifications.addListener('registrationError', (error) => {
      console.error('Push notification registration failed:', error);
    });
    await PushNotifications.addListener('pushNotificationReceived', async (notification) => {
      if (auth.currentUser?.uid !== user.uid) return;
      await showDeviceNotification({
        id: notification.data?.notificationId || notification.id || '',
        title: notification.title,
        body: notification.body,
        type: notification.data?.type || 'detection'
      });
    });
    await PushNotifications.register();
  } catch (error) {
    console.error('Could not enable device notifications:', error);
  }
}

document.querySelector('[data-persist="notify-detection"]')?.addEventListener('change', async (event) => {
  if (!pushRegistrationUserId || !Capacitor.isNativePlatform()) return;
  try {
    await NativePushTopics[event.currentTarget.checked ? 'subscribePestAlerts' : 'unsubscribePestAlerts']();
  } catch (error) {
    console.error('Could not update device alert preferences:', error);
  }
});

function paintTelemetry(data) {
  const percent = Math.max(0, Math.min(100, Number(data.batteryPercent ?? 82)));
  const dashboardGauge = document.querySelector('.dashboard .battery-gauge');
  const batteryGauge = document.querySelector('.battery-feature-card .large-battery-gauge');
  [dashboardGauge, batteryGauge].filter(Boolean).forEach((gauge) => {
    const value = gauge.querySelector('span');
    if (value) value.textContent = `${percent}%`;
    gauge.setAttribute('aria-label', `Battery level ${percent} percent`);
  });
  if (batteryGauge) {
    const angle = percent * 3.6;
    batteryGauge.style.background = `conic-gradient(from -45deg, #a28700 0deg ${angle}deg, #d7e5cf ${angle}deg 360deg)`;
  }

  [document.querySelector('.dashboard .battery-details p'), document.querySelector('.battery-info-card p')]
    .filter(Boolean)
    .forEach((paragraph) => {
      const fields = [
        ['Voltage: ', `${data.voltage ?? 10.5} V DC`],
        ['Charging source: ', String(data.chargingSource || 'Solar')],
        ['Battery Condition: ', String(data.batteryCondition || 'Normal')]
      ];
      paragraph.replaceChildren();
      fields.forEach(([label, value], index) => {
        if (index) paragraph.append(document.createElement('br'));
        paragraph.append(document.createTextNode(label));
        const strong = document.createElement('strong');
        strong.textContent = value;
        paragraph.append(strong);
      });
    });
}

async function addMonitoringLog(type, summary, extra = {}) {
  const data = { type, summary, ...extra };
  if (isConfigured) {
    if (!currentUser) throw new Error('Log in before saving data to Firebase.');
    await addDoc(userCollection('monitoringLogs'), { ...data, createdAt: serverTimestamp() });
    return;
  }
  const state = demoState();
  state.logs.unshift({ ...data, createdAt: new Date().toISOString() });
  state.logs = state.logs.slice(0, 200);
  saveDemo(state);
}

async function saveOperation(operationId, values, summary = 'Operation data updated') {
  if (isConfigured) {
    if (!currentUser) throw new Error('Log in before saving data to Firebase.');
    await setDoc(doc(db, 'users', currentUser.uid, 'operations', operationId), {
      ...values,
      updatedAt: serverTimestamp()
    }, { merge: true });
  } else {
    const state = demoState();
    state.operations[operationId] = { ...state.operations[operationId], ...values, updatedAt: new Date().toISOString() };
    saveDemo(state);
  }
  await addMonitoringLog('operation', summary, { operationId });
}

async function createDetection(record = {}) {
  const detection = {
    pest: record.pest || ['Maya', 'Rodents', 'Crickets'][Math.floor(Math.random() * 3)],
    confidence: Number(record.confidence ?? (80 + Math.random() * 19).toFixed(1)),
    source: record.source || 'app_prototype',
    detectedAt: new Date().toISOString(),
    response: record.response || 'Repellent ON'
  };
  if (isConfigured) {
    if (!currentUser) throw new Error('Log in before saving a detection to Firebase.');
    const detectionRef = await addDoc(userCollection('detections'), {
      ...detection,
      detectedAt: new Date(detection.detectedAt)
    });
    const batch = writeBatch(db);
    const createdAt = serverTimestamp();
    batch.set(doc(db, 'users', currentUser.uid, 'notifications', `detection_${detectionRef.id}`), {
      type: 'detection',
      title: `${detection.pest} detected`,
      message: 'A detection was recorded in your rice field.',
      detectionId: detectionRef.id,
      read: false,
      createdAt
    });
    batch.set(doc(db, 'users', currentUser.uid, 'monitoringLogs', `detection_${detectionRef.id}`), {
      type: 'pest_detection',
      source: detection.source,
      summary: `${detection.pest} detected`,
      detectionId: detectionRef.id,
      createdAt
    });
    await batch.commit();
    // The Cloudflare Worker verifies this Firestore alert and sends a high-
    // priority FCM message to the shared topic for every subscribed device.
    void sendDetectionPushToDevices(`detection_${detectionRef.id}`);
    paintDetections([{ ...detection, id: detectionRef.id }]);
    const notificationId = `detection_${detectionRef.id}`;
    const cachedNotifications = readUserCache(currentUser.uid, 'notifications');
    const nextNotifications = [
      {
        id: notificationId,
        type: 'detection',
        title: `${detection.pest} detected`,
        message: 'A detection was recorded in your rice field.',
        detectionId: detectionRef.id,
        read: false,
        createdAt: detection.detectedAt
      },
      ...cachedNotifications.filter((item) => item.id !== notificationId)
    ];
    saveUserCache(currentUser.uid, 'notifications', nextNotifications);
    paintNotifications(nextNotifications);
    showRealtimeToast({
      type: 'detection',
      title: `${detection.pest} detected`,
      message: `A ${detection.pest} detection was recorded in your rice field.`
    }, detectionRef.id);
    return detectionRef.id;
  }
  const state = demoState();
  const id = `demo-${Date.now()}`;
  state.detections.unshift({ ...detection, id });
  state.notifications.unshift({
    id: `notification-${id}`,
    type: 'detection',
    title: `${detection.pest} detected`,
    message: 'A prototype detection was recorded in your rice field.',
    read: false,
    createdAt: detection.detectedAt
  });
  state.logs.unshift({ type: 'pest_detection', summary: `${detection.pest} detected`, source: detection.source, createdAt: detection.detectedAt });
  saveDemo(state);
  paintDetections(state.detections);
  paintNotifications(state.notifications);
  notifyDemoWatchers();
  return id;
}

async function submitAuth(form) {
  if (!isConfigured) return false;
  const email = form.querySelector('[name="email"]')?.value.trim();
  const password = form.querySelector('[name="password"]')?.value;
  if (!email || !password) throw new Error('Enter your email and password.');
  if (form.id === 'signup-form') {
    const fullName = form.querySelector('[name="name"]')?.value.trim();
    const confirmation = form.querySelector('[name="confirm-password"]')?.value;
    if (!fullName) throw new Error('Enter your name.');
    if (password !== confirmation) throw new Error('Your passwords do not match.');
    if (!form.querySelector('[name="terms"]')?.checked) throw new Error('Accept the Terms and Conditions to continue.');
    const credential = await createUserWithEmailAndPassword(auth, email, password).catch((error) => { throw friendlyAuthError(error); });
    await updateProfile(credential.user, { displayName: fullName }).catch((error) => console.error('Could not update the new account name:', error));
    sessionStorage.setItem('aicoustic-signup-verification', 'true');
    sessionStorage.setItem('aicoustic-signup-email', email);
    // Auth account creation is authoritative. A Firestore rules/network issue
    // must not strand a newly created account before its verification email.
    setDoc(doc(db, 'users', credential.user.uid), {
      fullName,
      email,
      phone: '',
      createdAt: serverTimestamp()
    }, { merge: true }).catch((error) => console.error('Could not save the new user profile:', error));
    await sendEmailVerification(credential.user, { url: signupVerificationUrl() }).catch((error) => { throw friendlyAuthError(error); });
    sessionStorage.setItem('aicoustic-auth-message', 'Your account was created. Verify your email using the link we sent, then log in.');
    window.location.assign('verify%20email.html');
    return true;
  }
  const credential = await signInWithEmailAndPassword(auth, email, password).catch((error) => { throw friendlyAuthError(error); });
  if (!credential.user.emailVerified) {
    sessionStorage.setItem('aicoustic-signup-verification', 'true');
    sessionStorage.setItem('aicoustic-signup-email', email);
    window.location.assign('verify%20email.html');
    return true;
  }
  setDoc(doc(db, 'users', credential.user.uid), { email, lastLoginAt: serverTimestamp() }, { merge: true })
    .catch((error) => console.error('Could not update the Firebase user profile:', error));
  window.location.assign('dashboard.html');
  return true;
}

async function requestPasswordReset(email) {
  if (!isConfigured) throw new Error('Firebase is not configured. Add the Firebase values to .env.local and restart the app.');
  if (!email) throw new Error('Enter your email address.');
  await sendPasswordResetEmail(auth, email, { url: passwordResetUrl(), handleCodeInApp: false });
}

async function requestCurrentUserPasswordReset() {
  if (!currentUser?.email) throw new Error('Log in with an email account before changing its password.');
  await requestPasswordReset(currentUser.email);
}

async function completePasswordReset(code, newPassword) {
  if (!code) throw new Error('Open the password reset link from your email first.');
  await verifyPasswordResetCode(auth, code);
  await confirmPasswordReset(auth, code, newPassword);
}

async function resendSignupVerificationEmail() {
  if (!isConfigured || !auth.currentUser) throw new Error('Your pending signup session expired. Start signup again.');
  await reload(auth.currentUser);
  if (auth.currentUser.emailVerified) return;
  await sendEmailVerification(auth.currentUser, { url: signupVerificationUrl() });
}

async function confirmSignupEmailVerified() {
  if (!isConfigured || !auth.currentUser) throw new Error('Your pending signup session expired. Start signup again.');
  await reload(auth.currentUser);
  if (!auth.currentUser.emailVerified) return false;
  await signOut(auth);
  clearSignupVerification();
  sessionStorage.setItem('aicoustic-auth-message', 'Email verified. Log in with your new account.');
  return true;
}

async function signInWithGoogle() {
  if (!isConfigured) throw new Error('Firebase is not configured yet. Add the Firebase values to .env.local and restart the app.');
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  if (Capacitor.isNativePlatform()) {
    // Credential Manager returns NoCredentialException on some Android devices
    // even when a Google account is present. Use the plugin's native Google
    // account chooser in that case instead of relying on Credential Manager.
    const result = await FirebaseAuthentication.signInWithGoogle({ useCredentialManager: false });
    const idToken = result.credential?.idToken;
    if (!idToken) throw new Error('Google sign-in did not return an ID token. Check the Android SHA-1 in Firebase project settings.');
    await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
    return;
  }
  try {
    const credential = await signInWithPopup(auth, provider);
    if (!credential.user.emailVerified) {
      sessionStorage.setItem('aicoustic-signup-verification', 'true');
      sessionStorage.setItem('aicoustic-signup-email', credential.user.email || '');
      await sendEmailVerification(credential.user, { url: signupVerificationUrl() });
      window.location.assign('verify%20email.html');
      return;
    }
    window.location.assign('dashboard.html');
  } catch (error) {
    // Popup sign-in is blocked by some mobile browsers and embedded WebViews.
    if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/cancelled-popup-request'].includes(error.code)) {
      await signInWithRedirect(auth, provider);
      return;
    }
    throw friendlyAuthError(error);
  }
}

function friendlyAuthError(error) {
  const messages = {
    'auth/email-already-in-use': 'An account already uses this email. Log in or use Forgot Password.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/weak-password': 'Choose a stronger password with at least 6 characters.',
    'auth/invalid-credential': 'The email or password is incorrect. If you just signed up, verify your email first.',
    'auth/user-not-found': 'No account was found for this email. Create an account first.',
    'auth/wrong-password': 'The email or password is incorrect.',
    'auth/too-many-requests': 'Too many attempts. Wait a little while, then try again.',
    'auth/quota-exceeded': 'Firebase has reached its email sign-in limit for now. Wait for the quota to reset or ask the Firebase project owner to increase it.',
    'auth/unauthorized-domain': 'This app address is not authorized in Firebase Authentication. Add its domain under Authentication → Settings → Authorized domains.',
    'auth/unauthorized-continue-uri': 'Firebase rejected this app address for the verification link. Add the website domain to Firebase Authentication → Settings → Authorized domains, then try again.',
    'auth/operation-not-allowed': 'This sign-in method is disabled in Firebase Authentication. Enable Email/Password or Google under Sign-in method.',
    'auth/network-request-failed': 'Could not reach Firebase. Check your internet connection and try again.'
  };
  return new Error(messages[error?.code] || error?.message || 'Authentication failed. Please try again.');
}

async function logout() {
  if (auth) {
    if (Capacitor.isNativePlatform()) await FirebaseAuthentication.signOut();
    await signOut(auth);
  }
}

function showAccountProfile(user, profile = {}) {
  const name = profile.fullName || user.displayName || '';
  const email = profile.email || user.email || '';
  const phone = profile.phone || '';
  const fields = document.querySelectorAll('#account-details-panel input');
  const nameInput = document.querySelector('#account-details-panel input[name="full-name"]');
  const emailInput = document.querySelector('#account-details-panel input[name="email"]');
  const phoneInput = document.querySelector('#account-details-panel input[name="phone"]');
  if (nameInput) nameInput.value = name;
  if (emailInput) emailInput.value = email;
  const resetEmail = document.querySelector('[data-password-reset-email]');
  if (resetEmail) resetEmail.textContent = email || 'your account email';
  if (phoneInput) phoneInput.value = phone;
  const hero = document.querySelector('.account-hero');
  if (hero) {
    const heading = hero.querySelector('h1');
    const caption = hero.querySelector('small');
    if (heading) heading.textContent = name || 'Account User';
    if (caption) caption.textContent = email;
  }
  fields.forEach((field) => field.setAttribute('readonly', ''));
}

async function markNotificationsRead() {
  if (isConfigured && currentUser) {
    const uid = currentUser.uid;
    const optimistic = currentNotifications.map((item) => ({ ...item, read: true }));
    saveUserCache(uid, 'notifications', optimistic);
    paintNotifications(optimistic);

    try {
      const snapshot = await getDocs(userCollection('notifications'));
      const unreadDocs = snapshot.docs.filter((item) => !item.data().read);
      for (let index = 0; index < unreadDocs.length; index += 450) {
        const batch = writeBatch(db);
        unreadDocs.slice(index, index + 450).forEach((item) => batch.update(item.ref, { read: true, readAt: serverTimestamp() }));
        await batch.commit();
      }
    } catch (error) {
      console.error('Could not mark notifications as read:', error);
      throw error;
    }
    return;
  }
  const state = demoState();
  state.notifications = state.notifications.map((item) => ({ ...item, read: true }));
  saveDemo(state);
  paintNotifications(state.notifications);
}

async function clearAllNotifications() {
  if (isConfigured && currentUser) {
    const snapshot = await getDocs(userCollection('notifications'));
    const docs = snapshot.docs;
    for (let index = 0; index < docs.length; index += 450) {
      const batch = writeBatch(db);
      docs.slice(index, index + 450).forEach((item) => batch.delete(item.ref));
      await batch.commit();
    }
    return;
  }
  const state = demoState();
  state.notifications = [];
  saveDemo(state);
  paintNotifications(state.notifications);
}

window.aicousticBackend = {
  isConfigured,
  get currentUser() { return currentUser; },
  submitAuth,
  signInWithGoogle,
  resendSignupVerificationEmail,
  confirmSignupEmailVerified,
  requestPasswordReset,
  requestCurrentUserPasswordReset,
  completePasswordReset,
  logout,
  createDetection,
  saveOperation,
  addMonitoringLog,
  markNotificationsRead,
  clearAllNotifications
};

document.querySelector('[data-prototype-detection]')?.addEventListener('click', async () => {
  try {
    await createDetection();
  } catch (error) {
    const toast = document.querySelector('.settings-toast');
    if (toast) { toast.textContent = error.message; toast.hidden = false; }
  }
});

document.querySelector('.notification-clear')?.addEventListener('click', () => markNotificationsRead().catch(console.error));
document.querySelector('.notification-clear-all')?.addEventListener('click', () => clearAllNotifications().catch(console.error));

if (isConfigured) {
  const currentPage = decodeURIComponent(window.location.pathname.split('/').pop() || '').toLowerCase();
  if (currentPage === 'login.html' && !Capacitor.isNativePlatform()) getRedirectResult(auth).catch((error) => {
    const status = document.querySelector('#login-form .status');
    if (status) { status.textContent = friendlyAuthError(error).message; status.hidden = false; status.dataset.state = 'error'; }
  });
  onAuthStateChanged(auth, async (user) => {
    if (pushRegistrationUserId && (!user || pushRegistrationUserId !== user.uid)) {
      await NativePushTopics.unsubscribePestAlerts().catch((error) => console.warn('Could not unsubscribe the previous account device:', error));
      pushRegistrationUserId = null;
    }
    currentUser = user;
    const page = decodeURIComponent(window.location.pathname.split('/').pop() || '').toLowerCase();
    const returnedFromEmailVerification = page === 'login.html' && new URLSearchParams(window.location.search).get('verified') === '1';
    if (returnedFromEmailVerification && user) {
      try {
        await reload(user);
        if (auth.currentUser?.emailVerified) {
          await signOut(auth);
          clearSignupVerification();
          sessionStorage.setItem('aicoustic-auth-message', 'Email verified. Log in with your new account.');
          window.history.replaceState({}, '', window.location.pathname);
          currentUser = null;
          const status = document.querySelector('#login-form .status');
          if (status) { status.textContent = sessionStorage.getItem('aicoustic-auth-message'); status.hidden = false; }
          sessionStorage.removeItem('aicoustic-auth-message');
          return;
        }
      } catch (error) {
        console.error('Could not refresh email verification status:', error);
      }
    } else if (returnedFromEmailVerification) {
      clearSignupVerification();
      sessionStorage.setItem('aicoustic-auth-message', 'Email verified. You can now log in.');
      window.history.replaceState({}, '', window.location.pathname);
    }
    const publicPages = new Set(['', 'index.html', 'login.html', 'signup.html', 'forgot password.html', 'verify email.html', 'reset password.html']);
    const isPublicPage = publicPages.has(page);
    const isAppPage = window.location.pathname.toLowerCase().includes('/templates/') && !isPublicPage;
    if (isAppPage && !user) {
      window.location.replace('login.html');
      return;
    }
    if (isAppPage && user && !user.emailVerified) {
      sessionStorage.setItem('aicoustic-signup-verification', 'true');
      sessionStorage.setItem('aicoustic-signup-email', user.email || '');
      window.location.replace('verify%20email.html');
      return;
    }
    if (user && !user.emailVerified && (page === 'login.html' || (page === 'signup.html' && sessionStorage.getItem('aicoustic-signup-verification') === 'true'))) {
      sessionStorage.setItem('aicoustic-signup-verification', 'true');
      sessionStorage.setItem('aicoustic-signup-email', user.email || '');
      window.location.replace('verify%20email.html');
      return;
    }
    if (page === 'login.html' && user?.emailVerified) {
      window.location.replace('dashboard.html');
      return;
    }
    if (page === 'verify email.html' || (user && !user.emailVerified)) return;
    const successMessage = sessionStorage.getItem('aicoustic-auth-message');
    if (successMessage && document.querySelector('#login-form')) {
      const status = document.querySelector('#login-form .status');
      if (status) { status.textContent = successMessage; status.hidden = false; }
      sessionStorage.removeItem('aicoustic-auth-message');
    }
    if (!user) return;

    registerDevicePush(user);

    if (document.querySelector('#account-details-panel')) {
      showAccountProfile(user);
      getDoc(doc(db, 'users', user.uid)).then((snapshot) => {
        if (snapshot.exists()) showAccountProfile(user, snapshot.data());
      }).catch((error) => console.error('Could not load the account profile:', error));
    }

    if (document.querySelector('#detection-list') || document.querySelector('.dashboard')) {
      paintDetections(readUserCache(user.uid, 'detections'));
    }
    if (document.querySelector('#notification-menu')) {
      paintNotifications(readUserCache(user.uid, 'notifications'));
    }

    const detections = query(userCollection('detections'), orderBy('detectedAt', 'desc'), limit(100));
    if (document.querySelector('#detection-list') || document.querySelector('.dashboard')) {
      onSnapshot(detections, (snapshot) => {
        const records = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
        saveUserCache(user.uid, 'detections', records);
        paintDetections(records);
      }, (error) => {
        console.error('Detection listener failed:', error);
        const list = document.querySelector('#detection-list');
        if (list) {
          const message = document.createElement('p');
          message.className = 'empty-history';
          message.textContent = 'Could not load detection history. Check your Firebase connection and access rules.';
          list.replaceChildren(message);
        }
      });
    }

    const notifications = query(userCollection('notifications'), orderBy('createdAt', 'desc'));
    let firstNotificationSnapshot = true;
    onSnapshot(notifications, (snapshot) => {
      const items = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      saveUserCache(user.uid, 'notifications', items);
      paintNotifications(items);
      if (!firstNotificationSnapshot) snapshot.docChanges()
        .filter((change) => change.type === 'added')
        .forEach((change) => {
          const notification = change.doc.data();
          showRealtimeToast(notification, change.doc.id);
          showDeviceNotification({
            id: change.doc.id,
            title: notification.title,
            body: notification.message,
            type: notification.type || 'system'
          });
        });
      firstNotificationSnapshot = false;
    }, (error) => console.error('Notification listener failed:', error));

    const telemetry = doc(db, 'users', user.uid, 'operations', 'telemetry');
    getDoc(telemetry).then((snapshot) => {
      if (!snapshot.exists()) {
        return setDoc(telemetry, {
          batteryPercent: 82,
          voltage: 10.5,
          chargingSource: 'Solar',
          batteryCondition: 'Normal',
          systemState: 'Active',
          updatedAt: serverTimestamp()
        });
      }
    }).catch((error) => console.error('Could not initialize telemetry:', error));
    onSnapshot(telemetry, (snapshot) => { if (snapshot.exists()) paintTelemetry(snapshot.data()); }, (error) => console.error('Telemetry listener failed:', error));

    document.querySelectorAll('[data-persist]').forEach((control) => control.addEventListener('change', () => {
      saveOperation('preferences', { [control.dataset.persist]: control.checked }, `Preference ${control.dataset.persist} changed`)
        .catch((error) => console.error('Could not save preference:', error));
    }));

    document.querySelector('#wifi-toggle')?.addEventListener('change', (event) => {
      saveOperation('connectivity', { wifiEnabled: event.target.checked }, `Wi-Fi ${event.target.checked ? 'enabled' : 'disabled'}`)
        .catch((error) => console.error('Could not save Wi-Fi state:', error));
    });
    document.querySelector('#network-action')?.addEventListener('click', () => {
      setTimeout(() => {
        const name = document.querySelector('#selected-network-name')?.textContent || '';
        const status = document.querySelector('#selected-network-status')?.textContent || '';
        saveOperation('connectivity', { networkName: name, networkStatus: status }, `Network ${name}: ${status}`)
          .catch((error) => console.error('Could not save network status:', error));
      }, 0);
    });
    document.querySelectorAll('[data-storage-action]').forEach((button) => button.addEventListener('click', () => {
      saveOperation('storage', { lastAction: button.dataset.storageAction, actionAt: new Date().toISOString() }, `Storage action: ${button.dataset.storageAction}`)
        .catch((error) => console.error('Could not save storage action:', error));
    }));
    document.querySelector('.check-updates-button')?.addEventListener('click', () => {
      saveOperation('firmware', { lastCheckAt: new Date().toISOString(), currentVersion: '1.0.0' }, 'Firmware update check requested')
        .catch((error) => console.error('Could not save firmware check:', error));
    });
    document.querySelector('.edit-profile')?.addEventListener('click', () => {
      setTimeout(() => {
        const button = document.querySelector('.edit-profile');
        if (button?.dataset.editing !== 'false') return;
        const name = document.querySelector('#account-details-panel input[name="full-name"]')?.value.trim() || '';
        const email = auth.currentUser?.email || '';
        const phone = document.querySelector('#account-details-panel input[name="phone"]')?.value.trim() || '';
        updateProfile(auth.currentUser, { displayName: name }).then(() => setDoc(doc(db, 'users', auth.currentUser.uid), {
          fullName: name, email, phone, updatedAt: serverTimestamp()
        }, { merge: true })).then(() => saveOperation('profile', { displayName: name, phone }, 'Account profile edited'))
          .catch((error) => console.error('Could not save profile:', error));
      }, 0);
    });

  });
} else {
  const page = decodeURIComponent(window.location.pathname.split('/').pop() || '').toLowerCase();
  const publicPages = new Set(['', 'index.html', 'login.html', 'signup.html', 'forgot password.html', 'verify email.html', 'reset password.html']);
  if (window.location.pathname.toLowerCase().includes('/templates/') && !publicPages.has(page)) {
    window.location.replace('login.html');
  }
  const authMessage = sessionStorage.getItem('aicoustic-auth-message');
  if (authMessage && document.querySelector('#login-form .status')) {
    const status = document.querySelector('#login-form .status');
    status.textContent = authMessage;
    status.hidden = false;
    sessionStorage.removeItem('aicoustic-auth-message');
  }
}

console.info(`AI-coustic Firebase backend ${isConfigured ? 'connected' : 'not configured; local prototype mode active'}.`);
