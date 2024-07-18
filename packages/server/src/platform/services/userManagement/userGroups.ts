import { platformPrisma as prisma } from '../../prisma';
import { getLogger } from '../../logger';
import { config } from '../../config';
import bcrypt from 'bcryptjs';
import { Service } from '../../plugin';
import { findAuthByScheme } from './auth';

export const findUserByUid = async (uid: string, enabledUsersOnly = true) => {
  if (enabledUsersOnly) {
    return prisma.user.findUnique({
      where: { uid, enabled: true },
    });
  } else {
    return prisma.user.findUnique({
      where: { uid },
    });
  }
};
export const createUser = async (createdByUid: string, scheme: string, username: string, secret: string) => {
  const exists = prisma.authScheme.findFirst({
    where: {
      scheme,
      username,
    },
  });
  if (!exists) {
    return prisma.user.create({
      data: {
        authSchemes: {
          create: {
            scheme,
            username,
            secret,
          },
        },
        createdByUid,
      },
    });
  } else {
    throw new Error('User already exists');
  }
};

export const findGroupByUid = async (groupUid: string) => prisma.group.findUnique({ where: { uid: groupUid } });
export const findGroupMembers = async (groupUid: string) => {
  const group = await findGroupByUid(groupUid);
  if (group) {
    const membership = await prisma.userGroup.findMany({
      select: {
        user: true,
      },
      where: {
        groupId: group.id,
      },
    });
    return membership.map((m) => m.user);
  } else {
    return [];
  }
};
export const createUserGroup = async (createdByUid: string, label: string, description = '') => {
  return prisma.group.create({
    data: {
      label,
      description,
      createdByUid,
    },
  });
};
export const addUserToGroup = async (callerUid: string, groupUid: string, ...userUids: string[]) => {
  const group = await findGroupByUid(groupUid);
  if (!group) {
    getLogger('userGroups').error(`addUserToGroup(): Group/${groupUid} not found`);
    throw new Error(`Group/${groupUid} not found`);
  }
  await Promise.allSettled(
    userUids.map(async (userUid) => {
      const user = await prisma.user.findUnique({ where: { uid: userUid } });
      if (user) {
        return prisma.userGroup.upsert({
          where: {
            userId_groupId: {
              userId: user.id,
              groupId: group.id,
            },
          },
          update: {},
          create: {
            userId: user.id,
            groupId: group.id,
            createdByUId: callerUid,
          },
        });
      } else {
        getLogger('userGroups').warn(`User/${userUid} not found`);
        return null;
      }
    })
  );
};
export const removeUserFromGroup = async (callerUid: string, groupUid: string, ...userUids: string[]) => {
  const group = await findGroupByUid(groupUid);
  if (!group) {
    getLogger('userGroups').error(`removeUserFromGroup(): Group/${groupUid} not found`);
    throw new Error(`Group/${groupUid} not found`);
  }
  await Promise.allSettled(
    userUids.map(async (userUid) => {
      const user = await prisma.user.findUnique({ where: { uid: userUid } });
      if (user) {
        return prisma.userGroup.delete({
          where: {
            userId_groupId: {
              userId: user.id,
              groupId: group.id,
            },
          },
        });
      }
    })
  );
};

const createRootUserIfMissing = async (rootUID: string) => {
  return prisma.user.upsert({
    where: {
      uid: rootUID,
    },
    update: {},
    create: {
      uid: rootUID,
      createdByUid: rootUID,
    },
  });
};
const createAnonymousUserIfMissing = async (anonymousUID: string, createdByUid: string) => {
  return prisma.user.upsert({
    where: {
      uid: anonymousUID,
    },
    update: {},
    create: {
      uid: anonymousUID,
      createdByUid,
    },
  });
};

export async function init(this: Service) {
  this.setId('platform/userGroups');
  this.onStart(async () => {
    const rootUser = await createRootUserIfMissing(config.auth.rootUser);
    await createAnonymousUserIfMissing(config.auth.anonymousUser, rootUser.uid);
    const defaultUsers = config.auth.defaultUsers ?? [];
    if (defaultUsers) {
      return Promise.allSettled(
        defaultUsers.map(async (user: string) => {
          const [username, secret] = user.split('/');
          if (username.trim().length > 0 && secret.trim().length > 0) {
            const user = await findAuthByScheme('local', username);
            if (user == null) {
              const hashedPassword = await bcrypt.hash(secret, 12);
              await createUser(rootUser.uid, 'local', username, hashedPassword);
            }
          }
        })
      );
    }
  });
}
