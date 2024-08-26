import { config } from '../../config';
import { platformPrisma as prisma } from '../../prisma';
import { DateTime } from 'luxon';
import { schedule } from 'node-cron';
import { Service } from '../../plugin';
import notificationsRepository, { Contact, Notification } from './notificationRepository';
import { getLogger } from '../../logger';
import subscriptionRepository from './subscriptionRepository';
import { Permissions, SecurityContext } from '../../accessControl';

export abstract class NotificationProvider {
  protected constructor() {}
  abstract send(event: string, data: { [key: string]: any }, contact: Contact): Promise<void>;
}

type ChannelRegistration = {
  channel: string;
  provider: NotificationProvider;
};

class Notifications {
  readonly allChannels: ChannelRegistration[] = [];
  constructor() {}

  /**
   * Registers a Notification Provider to be responsible for formatting and sending of events for a particular channel.
   * There can be multiple providers added for a single channel.
   * @param channel
   * @param provider
   */
  use(channel: string, provider: NotificationProvider) {
    this.allChannels.push({ channel, provider });
  }
  getProvider(channel: string) {
    const reg = this.allChannels.find((registration) => registration.channel === channel);
    if (reg) {
      return reg.provider;
    } else {
      return undefined;
    }
  }
}
const notifications = new Notifications();

const purgeOldData = async () => {
  const cutOff = DateTime.now().minus({ day: config.notification.outBoundRetentionDays }).toJSDate();
  await prisma.messageOutBox.deleteMany({
    where: {
      sentAt: { lt: cutOff },
    },
  });
};

const doSend = async (notification: Notification) => {
  const provider = notifications.getProvider(notification.recipient.channel);
  if (provider) {
    try {
      await provider.send(notification.eventName, notification.data, notification.recipient);
      await notificationsRepository.updateNotification(notification.id, 'delivered');
    } catch (error) {
      getLogger('Notifications').error(
        `Failed to deliver notification over channel ${notification.recipient.channel}`,
        error
      );
      await notificationsRepository.updateNotification(notification.id, 'error');
    }
  }
};

class NotificationContext {
  private readonly recipient: string;
  private eventName?: string;
  private data?: object;
  private channels?: string[];

  constructor(recipient: string) {
    if (recipient.startsWith('user/') || recipient.startsWith('group/')) {
      this.recipient = recipient;
    } else {
      throw new Error('Notification recipient should start with "user/" or "group/"');
    }
  }

  event(eventName: string, data: { [key: string]: any }) {
    this.eventName = eventName;
    this.data = data;
    return this;
  }

  onChannel(channel: string, ...more: string[]) {
    this.channels = [channel, ...more];
    return this;
  }

  async send() {
    if (this.eventName == null || this.data == null) {
      throw new Error('Missing event and data in notification context');
    }
    const subs = await subscriptionRepository.getSubscriptionsByEvent(this.recipient, this.eventName);
    const contacts = subs
      .filter((sub) => !this.channels || this.channels.includes(sub.contact.channel))
      .map((sub) => sub.contact);
    return Promise.allSettled(
      contacts.map(async (contact) => {
        const notification = await notificationsRepository.saveNotification(this.eventName!, contact, this.data!);
        return doSend(notification);
      })
    );
  }
}

export const subscribeContactToEvent = async (
  securityContext: SecurityContext,
  eventName: string,
  contact: Contact
) => {
  const hasPermissions = await securityContext.hasPermissions(
    Permissions.CREATE | Permissions.UPDATE,
    `subscriptions/[ownerUid=${contact.userUid}]`
  );
  if (hasPermissions) {
    return subscriptionRepository.createSubscription(eventName, contact, securityContext.principalUid);
  } else {
    throw new Error(`No permissions to modify user's subscription`);
  }
};
export const notify = (recipientUid: string) => new NotificationContext(recipientUid);
export default notifications;

export function init(this: Service) {
  this.setId('platform/notifications');

  this.onStart(async () => {
    await purgeOldData();
    schedule('0 0 0 * * *', async () => {
      await purgeOldData();
    });
    schedule('*/5 * * * * *', async () => {
      (await notificationsRepository.findNotificationsByStatus('error'))
        .filter((notification) => notification.errorCount < 3)
        .map((notification) => doSend(notification));
    });
  });
}
