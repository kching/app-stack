import sendGridMail from '@sendgrid/mail';
import { config } from '../../config';
import { getLogger } from '../../logger';
import { NotificationProvider } from '../../types';

type EmailContent = {
  text: string;
  html: string;
};

export class SendGridProvider extends NotificationProvider {
  constructor() {
    super();
    const apiKey = config.env['SENDGRID_API_KEY'] as unknown as string;
    sendGridMail.setApiKey(apiKey);
  }

  async send(subject: string, content: EmailContent, recipients: string | string[]) {
    const data = {
      from: config.notification.fromEmail,
      to: recipients,
      subject,
      text: content.text,
      html: content.html,
    };
    try {
      if (Array.isArray(recipients)) {
        await sendGridMail.sendMultiple(data);
      } else {
        await sendGridMail.send(data);
      }
    } catch (error) {
      getLogger().error('Failed to send email via SendGrid', error);
    }
  }
}
