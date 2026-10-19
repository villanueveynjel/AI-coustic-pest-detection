# AI-coustic Rice Field Monitoring prototype

This project keeps the supplied multi-page frontend and adds Firebase Authentication, Cloud Firestore realtime data, Firebase Cloud Messaging alerts sent through a Cloudflare Worker, and a Capacitor Android wrapper. The Raspberry Pi is not required: use **Simulate Detection** on the dashboard to create a prototype event.

## Configure Firebase

1. Create a Firebase project and register a Web app in the Firebase Console.
2. In **Authentication → Sign-in method**, enable **Email/Password**, **Google**, and **Email link (passwordless sign-in)**. Google sign-in sends a fresh one-time email link on every sign-in; the link must be opened before the dashboard is available.
3. Create a **Cloud Firestore** database.
4. Copy `.env.example` to `.env.local` and replace each `VITE_FIREBASE_*` value with the Web app config from Firebase Console.
5. Install packages with `npm install` (`npm.cmd install` in PowerShell if script execution is blocked).
6. Sign in with Firebase CLI and select the project using `npx firebase login` and `npx firebase use --add`.
7. For local testing, confirm `localhost` is listed in **Authentication → Settings → Authorized domains**. In **Authentication → Templates → Password reset**, set the custom action URL to `http://localhost:5173/templates/reset%20password.html` so the app can validate the emailed reset code and collect the new password.
8. Deploy rules/indexes with `npm run firebase:deploy:rules`. Signup and password changes use Firebase Authentication email links; they do not require Resend or a Cloud Function.
9. Run `npm run dev` (`npm.cmd run dev` in PowerShell) to preview the app. Authentication is disabled until Firebase is configured; protected app pages return to login.

The browser config is a Firebase public client config, not an Admin SDK credential. Do not put service account keys in the frontend. Firestore access is restricted by `firestore.rules` to the signed-in user's own document subtree.

## Firestore data model

- `users/{uid}` — account profile and user metadata.
- `users/{uid}/detections/{detectionId}` — pest type, timestamp, confidence, and source.
- `users/{uid}/monitoringLogs/{logId}` — audit trail for detections and operations.
- `users/{uid}/operations/{operationId}` — latest connectivity, storage, battery, firmware, and preference values.
- `users/{uid}/notifications/{notificationId}` — realtime in-app alerts created when a detection is recorded.
- `users/{uid}/pushTokens/{tokenId}` — device push tokens for the signed-in user; removed from that account on logout.

The app listens to Firestore snapshots so history and notification changes appear without refreshing. A new detection creates an in-app alert and a push notification for every signed-in user device that granted notification permission. Android shows the push in the system tray when the app is in the background; while the app is open, it shows a native device alert plus the in-app toast. The Detection Alerts setting is respected per device. Mark all read hides the badge immediately, and the notification list scrolls within its panel. The radar sweep is green with no recent detection, red for 30 seconds after the latest detection, yellow for the next 30 seconds, then green again. Email/password login is restricted to verified accounts. Google sign-in requires opening a fresh email link each time before the homepage. Password reset and change-password requests send secure Firebase email links; the password changes only after the link's code is validated. The account settings profile reads the Firebase Auth name/email, and the phone field is blank unless the user saves one. Dashboard routes require an authenticated user and a completed Google email challenge when applicable.

### Signup email verification

Email/password signup sends Firebase Authentication's built-in verification link. After opening the link, the user returns to the app and logs in; unverified accounts cannot access protected pages. This flow does not use a custom email provider or the OTP Cloud Function. In Firebase Console, enable **Authentication → Sign-in method → Email/Password** and ensure the app's domain is listed under **Authentication → Settings → Authorized domains** (for local development, `localhost` must be authorized).

When a detection is recorded, the app asks the Cloudflare Worker to verify the signed-in Firebase user and the user's detection record, then send an FCM message to the fixed `aicoustic-pest-alerts` topic. Each signed-in Android device subscribes to that topic after the user grants notification permission. The Worker does not use Firebase Cloud Functions.

## Android APK

Install Android Studio with Android SDK Platform 35 and a compatible JDK (17 or newer), then run:

```powershell
npm install
npm run android:add
npm run apk:debug
```

The debug APK is generated at `android/app/build/outputs/apk/debug/app-debug.apk`. The APK can use Firestore realtime features after `.env.local` is configured and the web build is rebuilt. This project does not include a signing key for a Play Store release.

### Enable Android push notifications with Cloudflare Worker

1. In Firebase Console → **Project settings → Your apps**, register the Android app using package name `com.aicoustic.ricefield`. Download `google-services.json` and put it at `android/app/google-services.json`.
2. In Firebase Console → **Project settings → Cloud Messaging**, enable the Firebase Cloud Messaging API (V1).
3. In Firebase Console → **Project settings → Service accounts**, generate a private key JSON for the Firebase Admin SDK service account. In Google Cloud Console → **IAM**, grant that service account the **Firebase Cloud Messaging API Admin** role. Keep the JSON private; do not add it to the project or send it to anyone.
4. Install Wrangler if prompted and log in to Cloudflare from PowerShell:

   ```powershell
   cd "C:\path\to\FINAL-FINAL-APP-CAPSTONE\cloudflare-worker"
   npx wrangler login
   npx wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON
   ```

   When prompted for the secret, paste the entire contents of the service-account JSON file. The Worker checks that its `project_id` is `capstone-964c0`.
5. Deploy the Worker:

   ```powershell
   npx wrangler deploy
   ```

   Copy the deployed URL, then add `/notify-detection` to it. For example: `https://aicoustic-pest-alerts.<your-subdomain>.workers.dev/notify-detection`.
6. In the project root `.env.local`, set `VITE_PUSH_WORKER_URL` to that full URL. Keep all the existing `VITE_FIREBASE_*` values. Deploy the Firestore rules with `npm.cmd run firebase:deploy:rules`.
7. Build a fresh APK with `npm.cmd run apk:debug`, install it, sign in, and allow notifications when Android asks.

The Worker uses Cloudflare's free plan allowance for low-volume capstone testing. Firebase Authentication, Firestore and FCM remain in Firebase; Cloudflare only verifies detection requests and sends the FCM message. No Firebase Blaze upgrade or Cloud Function deployment is needed for this Worker path.

If push notifications are not arriving, confirm that `google-services.json` belongs to the same Firebase project as `.env.local`, the Cloudflare Worker is deployed and its URL is in `VITE_PUSH_WORKER_URL`, Android notification permission is allowed, and the device is signed in. The `google-services.json` file is project-specific and should remain private.
