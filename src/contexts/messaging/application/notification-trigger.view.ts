import type { NotificationTrigger } from '@prisma/client';
import { NotificationTriggerKey } from '@prisma/client';

export interface TriggerChannels {
  readonly whatsapp: boolean;
  readonly email: boolean;
  readonly sms: boolean;
}

/** Shape the admin panel consumes for each trigger card. */
export interface TriggerView {
  readonly key: NotificationTriggerKey;
  readonly enabled: boolean;
  readonly template: string;
  readonly channels: TriggerChannels;
}

/**
 * Funnel order of the trigger cards, as approved in the prototype (adm-10).
 *
 * The frontend renders the list exactly as received, so the ordering is a
 * backend responsibility — not something for the client to reinvent.
 */
export const TRIGGER_FUNNEL_ORDER: readonly NotificationTriggerKey[] = [
  NotificationTriggerKey.ORDER_CONFIRMED,
  NotificationTriggerKey.KIT_SHIPPED,
  NotificationTriggerKey.SAMPLE_RECEIVED,
  NotificationTriggerKey.REMINDER,
  NotificationTriggerKey.REPORT_READY,
];

/** Maps a persisted trigger row to the shape exposed by the admin API. */
export function toTriggerView(row: NotificationTrigger): TriggerView {
  return {
    key: row.key,
    enabled: row.enabled,
    template: row.template,
    channels: {
      whatsapp: row.channelWhatsapp,
      email: row.channelEmail,
      sms: row.channelSms,
    },
  };
}
