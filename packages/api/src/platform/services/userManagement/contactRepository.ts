import { platformPrisma } from '../../prisma';

class PrismaContactRepository {
  private readonly prisma: typeof platformPrisma;

  constructor(prisma: typeof platformPrisma) {
    this.prisma = prisma;
  }

  async getContactByAddress(principalUid: string, channel: string, address: string) {
    return this.prisma.contact.findUnique({
      where: {
        ownerUid_channel_address: {
          ownerUid: principalUid,
          channel,
          address,
        },
      },
    });
  }
}

export default new PrismaContactRepository(platformPrisma);
