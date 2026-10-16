import { useEffect } from 'react';
import { useNotificationContext, useTranslate } from 'ra-core';
import { useToast, type ToastTone } from '@demo-ds/react';

const TONE: Record<string, ToastTone> = { success: 'success', info: 'info', warning: 'warning', error: 'danger' };

/** Bridges ra-core notifications (useNotify) to the Bridge toast queue. Render once inside the layout. */
export function Notifier() {
  const { notifications, takeNotification } = useNotificationContext();
  const toast = useToast();
  const translate = useTranslate();

  useEffect(() => {
    if (notifications.length === 0) return;
    let next = takeNotification();
    while (next) {
      const { message, type, notificationOptions } = next;
      const args = (notificationOptions?.messageArgs ?? {}) as Record<string, unknown>;
      const title = typeof message === 'string' ? translate(message, { _: message, ...args }) : message;
      const autoHide = notificationOptions?.autoHideDuration;
      toast.add({ title, tone: TONE[type] ?? 'neutral', ...(typeof autoHide === 'number' ? { timeout: autoHide } : {}) });
      next = takeNotification();
    }
  }, [notifications, takeNotification, toast, translate]);

  return null;
}
