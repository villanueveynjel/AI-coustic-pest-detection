import { initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';

initializeApp();
const PEST_ALERT_TOPIC = 'aicoustic-pest-alerts';

export const sendDeviceNotification = onDocumentCreated(
  { document: 'users/{uid}/notifications/{notificationId}', region: 'asia-southeast1' },
  async (event) => {
    const notification = event.data?.data();
    if (!notification) return;

    // Trigger FCM as soon as the Firestore notification is written. Devices
    // subscribe to this topic when they sign in, so the app does not need a
    // second client-to-worker request before its system alert is sent.
    await getMessaging().send({
      topic: PEST_ALERT_TOPIC,
      notification: {
        title: String(notification.title || 'Rice field alert').slice(0, 100),
        body: String(notification.message || 'A new monitoring alert was received.').slice(0, 240)
      },
      data: {
        type: String(notification.type || 'system'),
        notificationId: String(event.params.notificationId),
        detectionId: String(notification.detectionId || '')
      },
      android: {
        priority: 'high',
        notification: { channelId: 'pest-alerts', sound: 'default' }
      }
    });
  }
);
