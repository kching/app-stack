import sendGridMail from '@sendgrid/mail';
import { config } from '../../config';
import { readYaml, scanForFiles } from '../../fileUtils';
import pug, { compileTemplate } from 'pug';
import { getLogger } from '../../logger';
import { NotificationProvider } from './index';
import { Contact } from './notificationRepository';

export class SendGridProvider extends NotificationProvider {
  private readonly templateRoot;
  private readonly subjects;
  private readonly emailTemplates: Map<string, Map<string, compileTemplate>> = new Map();

  constructor(apiKey: string, templateRoot: string = config.app.templateRoot) {
    super();
    this.templateRoot = templateRoot;
    this.subjects = readYaml(`${this.templateRoot}/email/subjects.yaml`) ?? {};
    sendGridMail.setApiKey(apiKey);
  }

  async send(event: string, data: { [p: string]: any }, contact: Contact) {
    const subject = this.getSubject(event, data) ?? '(no subject)';
    const htmlContent = await this.getBodyContent(event, data, 'html');
    const textContent = await this.getBodyContent(event, data, 'txt');

    if (htmlContent || textContent) {
      const payload = {
        from: config.notification.fromEmail,
        to: contact.address,
        subject: subject,
        text: textContent ?? '',
        html: htmlContent ?? '<html lang="en"><body></body></html>',
      };
      try {
        await sendGridMail.send(payload);
      } catch (error) {
        getLogger('SendGrid Provider').error('Failed to send email via SendGrid', error);
        throw error;
      }
    } else {
      throw new Error(`Unknown notification event ${event}`);
    }
  }

  private loadTemplate(templatePath: string, emailTemplates: Map<string, Map<string, compileTemplate>> = new Map()) {
    const parts = templatePath.split('.');
    if (parts.length > 2) {
      const contentType = parts[parts.length - 2];
      const eventName = parts.slice(0, parts.length - 2).join('.');

      let eventTemplates = this.emailTemplates.get(eventName);
      if (!eventTemplates) {
        eventTemplates = new Map<string, compileTemplate>();
        emailTemplates.set(eventName, eventTemplates);
      }
      if (!eventTemplates.has(contentType)) {
        eventTemplates.set(contentType, pug.compileFile(templatePath));
      }
    }
    return emailTemplates;
  }

  private getSubject(event: string, data: { [p: string]: any }) {
    const subject = this.subjects[event];
    if (subject) {
      return new Function('return `' + subject + '`;').call(data);
    } else {
      return undefined;
    }
  }

  private async getBodyContent(event: string, data: { [p: string]: any }, contentType: string) {
    const files = await scanForFiles(this.templateRoot, (file) => file.name.endsWith('.pug'));
    const emailTemplates = files.reduce((templates, file) => {
      this.loadTemplate(file, templates);
      return templates;
    }, this.emailTemplates);
    const eventTemplates = emailTemplates.get(event);
    if (eventTemplates != null) {
      const template = eventTemplates.get(contentType);
      if (template != null) {
        return template(data);
      }
    }
  }
}
