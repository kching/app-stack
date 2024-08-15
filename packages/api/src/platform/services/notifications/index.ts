import { config } from '../../config';
import { platformPrisma as prisma } from '../../prisma';
import { DateTime } from 'luxon';
import { schedule } from 'node-cron';
import { Permissions, SecurityContext } from '../../accessControl';

export abstract class NotificationProvider {
  protected constructor() {}
  abstract send(event: string, data: { [key: string]: any }, recipientAddress: string | string[]): Promise<void>;
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
}

const notifications = new Notifications();

const beforeSend = async (eventName: string, data: { [key: string]: any }, channel: string, address: string) => {
  return prisma.messageOutBox.create({
    select: { id: true },
    data: {
      eventName,
      data: JSON.stringify(data),
      channel,
      address,
    },
  });
};

const sendComplete = async (id: number) => {
  return prisma.messageOutBox.update({
    where: { id },
    data: {
      lastSentAt: new Date(),
      status: 'delivered',
    },
  });
};

const sendFailed = async (id: number) => {
  return prisma.messageOutBox.update({
    where: { id },
    data: {
      status: 'failed',
      lastSentAt: new Date(),
      errorCount: { increment: 1 },
    },
  });
};

const getDestinations = async (recipientUid: string, eventName: string) => {
  const result = await prisma.subscription.findMany({
    include: {
      contact: true,
    },
    where: {
      event: eventName,
      enabled: true,
      contact: {
        user: {
          uid: recipientUid,
        },
      },
    },
  });
  return result.map((r) => ({ channel: r.channel, address: r.contact.address }));
};

class NotificationContext {
  private readonly recipientUid: string;
  private eventName?: string;
  private data?: { [key: string]: any };
  private channels?: string[];

  constructor(recipientUid: string) {
    this.recipientUid = recipientUid;
  }
  event(eventName: string, data: { [key: string]: any }) {
    this.eventName = eventName;
    this.data = data;
    return this;
  }
  onChannel(channels: string | string[]) {
    if (Array.isArray(channels)) {
      this.channels = channels;
    } else {
      this.channels = [channels];
    }
    return this;
  }
  async send() {
    if (this.eventName == null || this.data == null) {
      throw new Error('Missing event and data in notification context');
    }
    const targetChannels = this.channels;
    let destinations: { channel: string; address: string }[] = [];
    if (targetChannels == null) {
      destinations = await getDestinations(this.recipientUid, this.eventName);
    } else {
      const user = await prisma.user.findUnique({
        include: {
          contacts: true,
        },
        where: {
          uid: this.recipientUid,
        },
      });
      if (user) {
        destinations = user.contacts
          .filter((c) => targetChannels.indexOf(c.channel) > -1)
          .map((c) => ({ channel: c.channel, address: c.address }));
      }
    }
    const eventName = this.eventName;
    const data = this.data;

    destinations.map(async ({ channel, address }) => {
      const registrations = notifications.allChannels.filter((registration) => registration.channel === channel);

      return Promise.all(
        registrations.map(async (registration) => {
          const message = await beforeSend(eventName, data, channel, address);
          try {
            await registration.provider.send(eventName, data, address);
            await sendComplete(message.id);
          } catch (error) {
            await sendFailed(message.id);
          }
        })
      );
    });
  }
}

export const notify = (recipientUid: string) => new NotificationContext(recipientUid);
export const notifyContact = async (contactUid: string, eventName: string, data: { [key: string]: any }) => {
  const contact = await prisma.contact.findUnique({
    where: {
      uid: contactUid,
    },
  });
  if (contact != null) {
    const providers = notifications.allChannels
      .filter((registration) => registration.channel === contact.channel)
      .map((registration) => registration.provider);
    providers.map(async (p) => {
      const message = await beforeSend(eventName, data, contact.channel, contact.address);
      try {
        await p.send(eventName, data, contact.address);
        await sendComplete(message.id);
      } catch (error) {
        await sendFailed(message.id);
      }
    });
  }
};
export const subscribeContactToEvent = async (
  securityContext: SecurityContext,
  contactUid: string,
  eventName: string
) => {
  const contact = await prisma.contact.findUnique({
    where: {
      uid: contactUid,
    },
  });
  if (contact) {
    const hasPermissions = await securityContext.hasPermissions(
      Permissions.CREATE | Permissions.UPDATE,
      `subscriptions/[userId=${contact.userId}`
    );
    if (hasPermissions) {
      await prisma.subscription.upsert({
        where: {
          contactId_event_channel: {
            contactId: contact.id,
            event: eventName,
            channel: contact.channel,
          },
        },
        update: {
          enabled: true,
        },
        create: {
          userId: contact.userId,
          ownerUid: contact.ownerUid,
          contactId: contact.id,
          event: eventName,
          channel: contact.channel,
          enabled: true,
        },
      });
    } else {
      throw new Error('No required permissions for changing user subscriptions');
    }
  } else {
    throw new Error(`No contaact UID=${contactUid} found.`);
  }
};
export default notifications;

const purgeOldData = async (cutOff: Date) => {
  await prisma.messageOutBox.deleteMany({
    where: {
      sentAt: { lt: cutOff },
    },
  });
};
purgeOldData(DateTime.now().minus({ day: config.notification.outBoundRetentionDays }).toJSDate()).then(() => {
  schedule('0 0 0 * * *', async () => {
    const cutOff = DateTime.now().minus({ day: config.notification.outBoundRetentionDays }).toJSDate();
    await purgeOldData(cutOff);
  });
});
