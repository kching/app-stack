import { platformPrisma, platformPrisma as prisma } from '../../prisma';
import { pick } from 'lodash';
import { getLogger } from '../../logger';

export type Status = 'pending' | 'delivered' | 'error';
export type NotificationId = number;
export type Contact = {
  userUid: string;
  channel: string;
  address: string;
  secret?: string | null;
};
export type Notification = {
  id: number;
  eventName: string;
  recipient: Contact;
  data: object;
  status: Status;
  sentAt: Date;
  lastSentAt?: Date;
  errorCount: number;
};

const logger = getLogger('Notifications');

class NotificationsRepository {
  private readonly prisma: typeof platformPrisma;

  constructor(prisma: typeof platformPrisma) {
    this.prisma = prisma;
  }

  async findNotificationsByStatus(status: Status): Promise<Notification[]> {
    const records = await this.prisma.messageOutBox.findMany({
      include: {
        contact: {
          include: { user: true },
        },
      },
      where: {
        status,
      },
    });
    return records.map((record) => {
      const { user, channel, address, secret } = record.contact;
      return {
        ...pick(record, ['id', 'eventName', 'sentAt', 'errorCount']),
        lastSentAt: record.lastSentAt ?? undefined,
        status: record.status as Status,
        data: JSON.parse(record.data),
        recipient: {
          userUid: user.uid,
          channel,
          address,
          secret: secret ?? undefined,
        },
      };
    });
  }

  async purge(cutOff: Date): Promise<number> {
    const records = await this.prisma.messageOutBox.deleteMany({
      where: {
        sentAt: { lt: cutOff },
      },
    });
    return records.count;
  }

  async saveNotification(
    eventName: string,
    { userUid, channel, address }: Contact,
    data: object
  ): Promise<Notification> {
    let contact = undefined;
    const user = await this.prisma.user.findUnique({
      where: { uid: userUid },
    });
    if (user) {
      contact = await this.prisma.contact.findUnique({
        include: {
          user: true,
        },
        where: {
          ownerUid_channel_address: {
            ownerUid: user.uid,
            channel,
            address,
          },
        },
      });
    }

    if (contact) {
      const notification = await this.prisma.messageOutBox.create({
        data: {
          eventName,
          data: JSON.stringify(data),
          contact: { connect: { id: contact.id } },
        },
      });

      return {
        ...pick(notification, ['id', 'eventName', 'sentAt', 'errorCount']),
        status: notification.status as Status,
        lastSentAt: notification.lastSentAt ?? undefined,
        data,
        recipient: {
          userUid: contact.user.uid,
          ...pick(contact, ['channel', 'address']),
          secret: contact.secret ?? undefined,
        },
      };
    } else {
      throw new Error(`Cannot find contact with address ${address} for channel ${channel}`);
    }
  }

  async updateNotification(notificationId: NotificationId, status: Status): Promise<Notification | undefined> {
    const now = new Date();
    const notification = await this.prisma.messageOutBox.update({
      where: { id: notificationId },
      data: {
        status,
        lastSentAt: now,
        sentAt: status === 'delivered' ? now : undefined,
        errorCount: status === 'error' ? { increment: 1 } : undefined,
      },
    });
    return undefined;
  }
}

export default new NotificationsRepository(prisma);
