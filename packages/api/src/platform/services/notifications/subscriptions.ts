import { Service } from '../../plugin';
import { UserContext } from '../userManagement/auth';
import { getLogger } from '../../logger';

const logger = getLogger('subscriptions');
import subscriptionRepository from './subscriptionRepository';
import { z } from 'zod';

const createSubscriptionSchema = z.object({
  event: z.string(),
  channel: z.string(),
  address: z.string(),
  secret: z.string().optional(),
});

export async function init(this: Service) {
  this.setId('platform/subscriptions');

  // Register endpoints for users to manage their subscriptions to notifications

  this.useEndpoint('get', '/subscriptions', async (req, res) => {
    const securityContext = (req.user as UserContext)?.securityContext;
    try {
      if (securityContext?.principalUid != null) {
        const subscriptions = await subscriptionRepository.getSubscriptionsByUser(securityContext?.principalUid);
        res.status(200).json(subscriptions).end();
      } else {
        res.status(401).end();
      }
    } catch (error) {
      logger.error(`Failed to retrieve user subscriptions ownerUid=${securityContext?.principalUid}`, error);
    }
  });

  this.useEndpoint('post', '/subscriptions', async (req, res) => {
    const securityContext = (req.user as UserContext)?.securityContext;
    const { event, channel, address, secret } = req.body;
    try {
      const subscription = await subscriptionRepository.createSubscription(event, {
        userUid: securityContext?.principalUid,
        channel,
        address,
        secret,
      });
      res.status(201).json(subscription).end();
    } catch (error) {
      res.status(500).json(error).end();
    }
  }).withValidation(createSubscriptionSchema);

  this.useEndpoint('put', '/subscription/:uid', async (req, res) => {
    const securityContext = (req.user as UserContext)?.securityContext;
    const { uid } = req.params;
    const subscription = await subscriptionRepository.findSubscriptionByUid(uid);
    if (subscription && subscription.ownerUid === securityContext?.principalUid) {
      const result = await subscriptionRepository.updateSubscription(uid, req.body);
      res.status(200).json(result).end();
    } else {
      res.status(401).end();
    }
  });

  this.useEndpoint('delete', '/subscriptions/:uid', async (req, res) => {
    const securityContext = (req.user as UserContext)?.securityContext;
    const { uid } = req.params;
    const subscription = await subscriptionRepository.findSubscriptionByUid(uid);
    if (subscription && subscription.ownerUid === securityContext?.principalUid) {
      const result = await subscriptionRepository.deleteSubscription(uid);
      res.status(204).json(result).end();
    } else {
      res.status(401).end();
    }
  });
}
