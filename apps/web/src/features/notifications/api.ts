import type {
  NotificationPrefsResponse,
  PushDeviceRegistration,
  RemovePushDeviceBody,
  TestNotificationBody,
  TestNotificationResponse,
  UpdateNotificationPrefsBody,
  VapidKeyResponse,
} from '@utmmsc/shared';
import { api } from '../../shared/api/client';

export const notificationsApi = {
  vapidKey: () => api<VapidKeyResponse>('/notifications/vapid-key', { auth: false }),
  registerDevice: (body: PushDeviceRegistration) => api<{ ok: true }>('/notifications/devices', { method: 'POST', body }),
  removeDevice: (body: RemovePushDeviceBody) => api<{ ok: true; removed: boolean }>('/notifications/devices', { method: 'DELETE', body }),
  prefs: () => api<NotificationPrefsResponse>('/notifications/prefs'),
  updatePrefs: (body: UpdateNotificationPrefsBody) => api<NotificationPrefsResponse>('/notifications/prefs', { method: 'PATCH', body }),
  test: (body?: TestNotificationBody) => api<TestNotificationResponse>('/notifications/test', body ? { method: 'POST', body } : { method: 'POST' }),
};
