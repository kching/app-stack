export abstract class NotificationProvider {
  protected constructor() {}
  abstract send(event: string, data: { [key: string]: any }, recipientAddress: string | string[]): Promise<void>;
}
