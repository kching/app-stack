import { User } from '@prisma/client';
import pug, { compileTemplate } from 'pug';
import { config } from '../config';
import { readYaml, scanForFiles } from '../fileUtils';
import path from 'path';
import { prisma } from '../prisma';
import { SendGridProvider } from './email';
import { DateTime } from 'luxon';
import { cron } from '../scheduler';
import { NotificationProvider } from '../types';

const subjects = readYaml(`${config.app.templateRoot}/subjects.yaml`);

type Channel = {
  contentTypes: string[];
  provider: NotificationProvider;
  templates: { [templateName: string]: compileTemplate };
};

const purgeOldData = async (cutOff: Date) => {
  await prisma.messageOutBox.deleteMany({
    where: {
      sentAt: { lt: cutOff },
    },
  });
};
purgeOldData(DateTime.now().minus({ day: config.notification.outBoundRetentionDays }).toJSDate()).then(() => {
  cron('0 0 0 * * *', async () => {
    const cutOff = DateTime.now().minus({ day: config.notification.outBoundRetentionDays }).toJSDate();
    await purgeOldData(cutOff);
  });
});

const loadTemplates = async (templateRoot: string, channelName: string) => {
  const filePaths = await scanForFiles(`${templateRoot}/${channelName}`, (file) => file.name.endsWith('.pug'));
  return filePaths.reduce(
    (result, filePath) => {
      const name = path.basename(filePath).substring(0, -4);
      result[name] = pug.compileFile(filePath);
      return result;
    },
    {} as { [name: string]: compileTemplate }
  );
};

type Formatter = typeof format;
const format = (templateName: string, channel: Channel, data: { [key: string]: any }, contentType = 'html') => {
  const lookupName = templateName + '.' + contentType;
  const template = channel.templates[lookupName];
  if (template) {
    return template(data);
  }
  return null;
};

const preSend = async (
  templateName: string,
  channelName: string,
  data: { [key: string]: any },
  address: string | string[]
) => {
  return prisma.messageOutBox.create({
    select: { id: true },
    data: {
      templateName,
      channelName,
      data: JSON.stringify(data),
      address: JSON.stringify(address),
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

export class NotificationService {
  private readonly channels: { [channelName: string]: Channel } = {};
  private readonly templateRoot: string;
  private readonly formatter: Formatter;

  constructor(templateRoot: string, formatter: Formatter) {
    this.templateRoot = templateRoot;
    this.formatter = formatter;
  }
  async addChannel(channelName: string, contentTypes: string[], provider: NotificationProvider) {
    const templates = await loadTemplates(this.templateRoot, channelName);
    this.channels[channelName] = {
      contentTypes,
      provider,
      templates: templates,
    };
  }

  getChannel(channelName: string) {
    return this.channels[channelName];
  }

  async send(templateName: string, channelName: string, data: { [key: string]: any }, address: string | string[]) {
    const channel = this.getChannel(channelName);
    if (templateName && channelName && channel && address) {
      const subject = subjects[templateName];
      const contentPayload = channel.contentTypes.reduce(
        (result, contentType) => {
          const contentFragment = format(templateName, channel, data, contentType);
          if (contentFragment) {
            result[contentType] = contentFragment;
          }
          return result;
        },
        {} as { [contentType: string]: string }
      );

      let message;
      try {
        message = await preSend(templateName, channelName, data, address);
        await channel.provider.send(subject, contentPayload, address);
        await sendComplete(message.id);
      } catch (error) {
        if (message) {
          await sendFailed(message.id);
        }
      }
    }
  }
}

class NotificationContext {
  private readonly recipient: User;
  private templateName: string | null = null;
  private data: { [key: string]: any } = {};
  private channels: string[] = [];

  constructor(recipients: User) {
    this.recipient = recipients;
  }
  withMessage(template: string, data: { [key: string]: any }) {
    this.templateName = template;
    this.data = data;
    return this;
  }
  overChannel(channels: string | string[]) {
    if (Array.isArray(channels)) {
      this.channels = channels;
    } else {
      this.channels = [channels];
    }
    return this;
  }
  async send() {
    if (this.templateName == null) {
      return;
    } else {
      await Promise.allSettled(
        this.channels.map(async (channelName) => {
          if (this.templateName != null) {
            const contacts = await prisma.contact.findMany({
              select: { address: true },
              where: {
                userId: this.recipient.id,
                channel: channelName,
              },
            });
            await notificationService.send(
              this.templateName,
              channelName,
              this.data,
              contacts.map((contact) => contact.address)
            );
          }
        })
      );
    }
  }
}

const notificationService = new NotificationService(config.app.templateRoot, format);
notificationService.addChannel('email', ['html', 'txt'], new SendGridProvider());

export const notify = (recipient: User) => new NotificationContext(recipient);

export const notifyEvent = async (recipient: User, event: string) => {
  const context = new NotificationContext(recipient);
  const subscriptions = await prisma.subscription.findMany({
    select: {
      channel: true,
    },
    where: {
      userId: recipient.id,
      enabled: true,
      event: event,
    },
  });
  return context.overChannel(subscriptions.map((sub) => sub.channel));
};

export default notificationService;
