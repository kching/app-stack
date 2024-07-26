import sendGridMail from '@sendgrid/mail';
import { config } from '../../config';
import { NotificationProvider } from '../../types';
import { readYaml, scanForFiles } from '../../fileUtils';
import pug, { compileTemplate } from 'pug';
import { getLogger } from '../../logger';

export class SendGridProvider extends NotificationProvider {
  private readonly subjects = readYaml(`${config.app.templateRoot}/email/subjects.yaml`);
  private readonly emailTemplates: { [event: string]: { [contentType: string]: compileTemplate } } = {};

  constructor(templateRoot: string) {
    super();
    const apiKey = config.env['SENDGRID_API_KEY'] as unknown as string;
    sendGridMail.setApiKey(apiKey);
    scanForFiles(templateRoot, (file) => file.name.endsWith('.pug')).then((filePaths) => {
      filePaths.map((filePath) => this.loadTemplate(filePath));
    });
  }

  loadTemplate(templatePath: string) {
    const parts = templatePath.split('.');
    if (parts.length > 2) {
      const contentType = parts[parts.length - 2];
      const eventName = parts.slice(0, parts.length - 2).join('.');

      let eventTemplates = this.emailTemplates[eventName];
      if (!eventTemplates) {
        eventTemplates = {};
        this.emailTemplates[eventName] = eventTemplates;
      }
      eventTemplates[contentType] = pug.compileFile(templatePath);
    }
  }

  async send(event: string, data: { [p: string]: any }, recipientAddress: string | string[]) {
    if (recipientAddress == null || (Array.isArray(recipientAddress) && recipientAddress.length === 0)) {
      throw new Error('No recipient address specified');
    }

    if (this.emailTemplates[event]) {
      const textContent = this.emailTemplates[event]['txt'] ? this.emailTemplates[event]['txt'](data) : '';
      const htmlContent = this.emailTemplates[event]['html']
        ? this.emailTemplates[event]['html'](data)
        : '<html lang="en"><body></body></html>';
      const payload = {
        from: config.notification.fromEmail,
        to: recipientAddress,
        subject: this.subjects[event] ?? '<No subject>',
        text: textContent,
        html: htmlContent,
      };
      try {
        if (Array.isArray(recipientAddress)) {
          await sendGridMail.sendMultiple(payload);
        } else {
          await sendGridMail.send(payload);
        }
      } catch (error) {
        getLogger('SendGrid Provider').error('Failed to send email via SendGrid', error);
        throw error;
      }
    } else {
      throw new Error(`Unknown notification event ${event}`);
    }
  }
}
