import { findUserByUid } from './auth';
import { prisma } from '../prisma';
import { jest } from '@jest/globals';

jest.mock('../notifications', () => ({
  notify: jest.fn(),
}));

jest.mock('../prisma', () => ({
  __esModule: true,
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
    expiredToken: {
      deleteMany: jest.fn(),
    },
  },
}));

describe('authentication', () => {
  it('find users', async () => {
    await findUserByUid('someUID');
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: {
        uid: 'someUID',
        enabled: true,
      },
    });
    await findUserByUid('someUID', false);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: {
        uid: 'someUID',
      },
    });
  });
});
