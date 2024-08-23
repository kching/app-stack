import { platformPrisma, platformPrisma as prisma } from '../../prisma';
import { omit, pick } from 'lodash';
import { Contact } from './notificationRepository';

export type Subscription = {
  id: number;
  event: string;
  contact: Contact;
};

export type SubscriptionUpdates = {
  event?: string;
  enabled?: boolean;
  displayOrder?: number;
  contact?: Contact;
};

class PrismaSubscriptionsRepository {
  private readonly prisma: typeof platformPrisma;

  constructor(prisma: typeof platformPrisma) {
    this.prisma = prisma;
  }

  async getSubscriptionsByEvent(recipient: string, eventName: string): Promise<Subscription[]> {
    const [type, uid] = recipient.split('/');
    if (type.toLowerCase() === 'user') {
      const result = await this.prisma.subscription.findMany({
        include: {
          contact: true,
        },
        where: {
          event: eventName,
          enabled: true,
          ownerUid: uid,
        },
      });
      return result.map((sub) => ({
        ...pick(sub, ['id', 'event']),
        contact: {
          userUid: sub.ownerUid,
          ...pick(sub.contact, ['channel', 'address', 'secret']),
        },
      }));
    } else if (type.toLowerCase() === 'group') {
      const memberships = await this.prisma.userGroup.findMany({
        include: {
          user: {
            include: {
              contacts: true,
            },
          },
        },
        where: {
          group: {
            uid: uid,
          },
        },
      });
      const contactIds = memberships.reduce(
        (contactIds, membership) => contactIds.concat(membership.user.contacts.map((c) => c.id)),
        [] as number[]
      );
      const subscriptions = await prisma.subscription.findMany({
        include: {
          contact: true,
        },
        where: {
          enabled: true,
          event: eventName,
          contactId: { in: contactIds },
        },
      });
      return subscriptions.map((sub) => ({
        ...pick(sub, ['id', 'event']),
        contact: {
          userUid: sub.ownerUid,
          ...pick(sub.contact, ['channel', 'address', 'secret']),
        },
      }));
    } else {
      throw new Error(`Unknown recipient type: ${type} for recipient ${recipient}`);
    }
  }

  async getSubscriptionsByUser(userUid: string): Promise<Subscription[]> {
    const subscriptions = await this.prisma.subscription.findMany({
      include: {
        contact: true,
      },
      where: {
        ownerUid: userUid,
      },
    });
    return subscriptions.map((sub) => ({
      ...pick(sub, ['id', 'event']),
      contact: {
        userUid: userUid,
        ...pick(sub.contact, ['channel', 'address', 'secret']),
      },
    }));
  }

  async createSubscription(event: string, { userUid, channel, address, secret }: Contact): Promise<Subscription> {
    const user = await this.prisma.user.findUnique({
      where: { uid: userUid },
    });

    if (user) {
      const count = await this.prisma.subscription.count({
        where: { ownerUid: userUid },
      });
      const contact = await this.prisma.contact.upsert({
        where: {
          ownerUid_channel_address: {
            ownerUid: user.uid,
            channel,
            address,
          },
        },
        create: {
          user: { connect: { id: user.id } },
          ownerUid: user.uid,
          address,
          secret,
          channel,
        },
        update: {},
      });
      const subscription = await this.prisma.subscription.upsert({
        include: {
          contact: true,
        },
        where: {
          contactId_event: {
            contactId: contact.id,
            event,
          },
        },
        create: {
          event,
          enabled: true,
          ownerUid: userUid,
          displayOrder: count,
          contact: { connect: { id: contact.id } },
        },
        update: {},
      });
      return {
        ...pick(subscription, ['id', 'event']),
        contact: {
          userUid: userUid,
          ...pick(contact, ['channel', 'address', 'secret']),
        },
      };
    } else {
      throw new Error(`No user record with uuid = ${userUid}`);
    }
  }

  async deleteSubscription(subscriptionId: number): Promise<Subscription | undefined> {
    const subscription = await this.prisma.subscription.delete({
      include: {
        contact: true,
      },
      where: { id: subscriptionId },
    });
    return {
      ...pick(subscription, ['id', 'event']),
      contact: {
        userUid: subscription.ownerUid,
        ...pick(subscription.contact, ['channel', 'address', 'secret']),
      },
    };
  }

  async updateSubscription(subscriptionId: number, updates: SubscriptionUpdates): Promise<Subscription | undefined> {
    let subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
    });
    if (subscription) {
      let updateContact = undefined;
      if (updates.contact) {
        const { channel, address, secret } = updates.contact;
        updateContact = {
          connectOrCreate: {
            where: {
              ownerUid_channel_address: {
                ownerUid: subscription.ownerUid,
                channel,
                address,
              },
            },
            create: {
              user: { connect: { uid: subscription.ownerUid } },
              ownerUid: subscription.ownerUid,
              channel,
              address,
            },
          },
        };
      }
      const updatedSubscription = await this.prisma.subscription.update({
        include: {
          contact: true,
        },
        where: { id: subscriptionId },
        data: {
          ...omit(updates, ['contact']),
          contact: updateContact,
        },
      });
      return {
        ...pick(updatedSubscription, ['id', 'event']),
        contact: {
          userUid: updatedSubscription.ownerUid,
          ...pick(updatedSubscription.contact, ['channel', 'address', 'secret']),
        },
      };
    } else {
      return undefined;
    }
  }
}
export default new PrismaSubscriptionsRepository(prisma);
