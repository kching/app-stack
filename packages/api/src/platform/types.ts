export abstract class NotificationProvider {
  protected constructor() {}
  abstract send(
    subject: string,
    content: { [contentType: string]: string },
    recipients: string | string[]
  ): Promise<void>;
}
