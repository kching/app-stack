import { platformPrisma } from '../../prisma';
import { omit, pick } from 'lodash';
import { Contact } from './notificationRepository';
import contactRepository from '../userManagement/contactRepository';

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

  async findSubscriptionByUid(uid: string) {
    return this.prisma.subscription.findUnique({
      where: { uid },
    });
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
      const subscriptions = await this.prisma.subscription.findMany({
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

  async createSubscription(
    event: string,
    { userUid, channel, address, secret }: Contact,
    ownerUid?: string
  ): Promise<Subscription> {
    const user = await this.prisma.user.findUnique({
      where: { uid: userUid },
    });

    if (user) {
      const count = await this.prisma.subscription.count({
        where: { ownerUid: userUid },
      });
      const contact = await contactRepository.getContactByAddress(userUid, channel, address);
      if (contact) {
        const existingSubs = await this.prisma.subscription.findUnique({
          where: {
            contactId_event: {
              contactId: contact.id,
              event,
            },
          },
        });
        if (existingSubs) {
          throw new Error('duplicateSubscription');
        }
      }
      const subscription = await this.prisma.subscription.create({
        include: {
          contact: true,
        },
        data: {
          event,
          enabled: true,
          ownerUid: ownerUid ?? userUid,
          displayOrder: count,
          contact: {
            connectOrCreate: {
              where: {
                ownerUid_channel_address: {
                  ownerUid: userUid,
                  channel,
                  address,
                },
              },
              create: {
                user: { connect: { uid: userUid } },
                ownerUid: userUid,
                channel,
                address,
                secret,
              },
            },
          },
        },
      });
      return {
        ...pick(subscription, ['id', 'event']),
        contact: {
          userUid: userUid,
          ...pick(subscription.contact, ['channel', 'address', 'secret']),
        },
      };
    } else {
      throw new Error(`No user record with uuid = ${userUid}`);
    }
  }

  async deleteSubscription(subscriptionUid: string): Promise<Subscription | undefined> {
    const subscription = await this.prisma.subscription.delete({
      include: {
        contact: true,
      },
      where: { uid: subscriptionUid },
    });
    return {
      ...pick(subscription, ['id', 'event']),
      contact: {
        userUid: subscription.contact.ownerUid,
        ...pick(subscription.contact, ['channel', 'address']),
      },
    };
  }

  async updateSubscription(subscriptionUid: string, updates: SubscriptionUpdates): Promise<Subscription | undefined> {
    let subscription = await this.prisma.subscription.findUnique({
      where: { uid: subscriptionUid },
    });
    if (subscription) {
      let updateContact = undefined;
      if (updates.contact) {
        const { userUid, channel, address, secret } = updates.contact;
        updateContact = {
          connectOrCreate: {
            where: {
              ownerUid_channel_address: {
                ownerUid: userUid,
                channel,
                address,
              },
            },
            create: {
              user: { connect: { uid: userUid } },
              ownerUid: userUid,
              channel,
              address,
              secret,
            },
          },
        };
      }
      const updatedSubscription = await this.prisma.subscription.update({
        include: {
          contact: true,
        },
        where: { uid: subscriptionUid },
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
export default new PrismaSubscriptionsRepository(platformPrisma);
