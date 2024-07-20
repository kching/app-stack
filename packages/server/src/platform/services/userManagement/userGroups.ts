import { platformPrisma as prisma } from '../../prisma';
import { getLogger } from '../../logger';
import { config } from '../../config';
import bcrypt from 'bcryptjs';
import { Service } from '../../plugin';
import { findAuthByScheme } from './auth';

type Action = 'CREATE' | 'UPDATE' | 'DELETE';
type UserProfileUpdate = {
  displayName?: string;
  enabled?: boolean;
  contacts?: {
    action: Action;
    uid: string | undefined;
    channel: string;
    address: string;
  }[];
};

type UserGroupUpdate = {
  label?: string;
  description?: string;
  members: {
    action: Action;
    userUid: string;
  };
};

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
export const findAllUsers = async (callerId: string, enabledUsersOnly = true) => {
  if (enabledUsersOnly) {
    return prisma.user.findMany({
      where: { enabled: true },
    });
  } else {
    return prisma.user.findMany({});
  }
};
export const createUser = async (createdByUid: string, scheme: string, username: string, secret: string) => {
  return prisma.$transaction(async (tx) => {
    const exists = await tx.authScheme.findFirst({
      include: {
        user: true,
      },
      where: {
        scheme,
        username,
      },
    });
    if (!exists) {
      return tx.user.create({
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
      return exists.user;
    }
  });
};
export const updateUser = async (
  callerUid: string,
  userUid: string,
  { displayName, enabled, contacts }: UserProfileUpdate
) => {
  // TODO: validate caller
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: {
        uid: userUid,
      },
      data: {
        displayName,
        enabled,
      },
    });
    if (user && Array.isArray(contacts)) {
      await Promise.all(
        contacts.map(async ({ action, uid, channel, address }) => {
          if (action === 'CREATE') {
            return tx.contact.create({
              data: {
                userId: user.id,
                channel,
                address,
              },
            });
          } else if (action === 'UPDATE') {
            return tx.contact.update({
              where: {
                uid,
              },
              data: {
                userId: user.id,
                channel,
                address,
              },
            });
          } else if (action === 'DELETE') {
            return tx.contact.delete({
              where: {
                uid,
              },
            });
          }
        })
      );
    }
  });
};

export const findGroupByUid = async (groupUid: string) => {
  const group = await prisma.group.findUnique({ where: { uid: groupUid } });
  if (group) {
    const membership = await prisma.userGroup.findMany({
      select: {
        user: true,
      },
      where: {
        groupId: group.id,
      },
    });
    const members = membership.map((m) => m.user);
    return {
      ...group,
      members,
    };
  } else {
    return null;
  }
};
export const findAllGroups = async (callerId: string) => {
  const groups = await prisma.group.findMany({});
  groups.map(async (group) => {
    const membership = await prisma.userGroup.findMany({
      select: {
        uid: true,
        userId: true,
      },
      where: { groupId: group.id },
    });
    return {
      ...group,
      membership: membership,
    };
  });
};
export const createUserGroup = async (callerUid: string, label: string, description = '') => {
  // TODO check for permissions
  return prisma.group.create({
    data: {
      label,
      description,
      createdByUid: callerUid,
    },
  });
};
export const updateUserGroup = async (
  callerUid: string,
  groupUid: string,
  attributes: {
    label?: string;
    description?: string;
  }
) => {
  // TODO check for permissions
  const { label, description } = attributes;
  const group = await prisma.group.findUnique({
    where: { uid: groupUid },
  });
  if (group) {
    await prisma.group.update({
      where: { uid: groupUid },
      data: {
        label: label,
        description: description,
      },
    });
  }
  return group;
};
export const deleteUserGroup = async (callerUid: string, groupUid: string) => {
  return prisma.group.delete({
    where: { uid: groupUid },
  });
};

export const updateGroupMembership = async (
  callerUid: string,
  groupUid: string,
  memberUpdates: { action: Action; userUid: string }[]
) => {
  // TODO check for permissions
  return prisma.$transaction(async (tx) => {
    const group = await findGroupByUid(groupUid);
    if (!group) {
      getLogger('userGroups').error(`addUserToGroup(): Group/${groupUid} not found`);
      throw new Error(`Group/${groupUid} not found`);
    }
    await Promise.allSettled(
      memberUpdates
        .filter(({ userUid }) => userUid != null)
        .map(async ({ action, userUid }) => {
          const user = await prisma.user.findUnique({ where: { uid: userUid } });
          if (user) {
            switch (action) {
              case 'CREATE':
                return prisma.userGroup.upsert({
                  where: {
                    userId_groupId: {
                      userId: user.id,
                      groupId: group.id,
                    },
                  },
                  create: {
                    userId: user.id,
                    groupId: group.id,
                    createdByUId: callerUid,
                  },
                  update: {
                    userId: user.id,
                    groupId: group.id,
                  },
                });
              case 'UPDATE':
                return prisma.userGroup.update({
                  where: {
                    userId_groupId: {
                      userId: user.id,
                      groupId: group.id,
                    },
                  },
                  data: {
                    userId: user.id,
                    groupId: group.id,
                  },
                });
              case 'DELETE':
                return prisma.userGroup.delete({
                  where: {
                    userId_groupId: {
                      userId: user.id,
                      groupId: group.id,
                    },
                  },
                });
            }
          } else {
            getLogger('userGroups').warn(`User/${userUid} not found`);
            return null;
          }
        })
    );
  });
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

  this.useEndpoint('get', '/users', async (req, res) => {
    const { uid } = req.user as { uid: string };
    const users = await findAllUsers(uid);
    res.status(200).json(users);
  });

  this.useEndpoint('post', '/users', async (req, res) => {
    const user = req.user as { uid: string };
    if (user) {
      const { username, secret, emailAddress } = req.body;
      await createUser(user.uid, username, secret, emailAddress);
    }
    res.status(200).json({});
  });

  this.useEndpoint('patch', '/users/:uid', async (req, res) => {
    const callerUid = (req.user as { uid: string })?.uid;
    const { uid } = req.params;
    const user = await updateUser(callerUid, uid, req.body);
    res.status(200).json(user);
  });

  this.useEndpoint('post', '/groups', async (req, res) => {
    const { uid } = req.user as { uid: string };
    const group = await createUserGroup(uid, req.body);
    res.status(200).json(group);
  });

  this.useEndpoint('get', '/groups', async (req, res) => {
    const { uid } = req.user as { uid: string };
    // TODO check for permissions
    const groups = await findAllGroups(uid);
    res.status(200).json(groups);
  });

  this.useEndpoint('get', '/groups/:uid', async (req, res) => {
    const callerId = (req.user as { uid: string })?.uid;
    // TODO check for permissions
    const { uid } = req.params;
    const group = await findGroupByUid(uid);
    if (group) {
      res.status(200).json(group);
    } else {
      res.status(204);
    }
  });

  this.useEndpoint('patch', '/groups/:uid', async (req, res) => {
    const callerId = (req.user as { uid: string })?.uid;
    const { uid } = req.params;
    const { label, description, members } = req.body as UserGroupUpdate;
    const group = prisma.$transaction(async (tx) => {
      const group = await updateUserGroup(callerId, uid, { label, description });
      if (Array.isArray(members)) {
        await updateGroupMembership(callerId, uid, members);
      }
      return group;
    });
    res.status(200).json(group);
  });

  this.useEndpoint('delete', '/groups:/uid', async (req, res) => {
    const callerId = (req.user as { uid: string })?.uid;
    const { uid } = req.params;
    const group = await deleteUserGroup(callerId, uid);
    res.status(200).json(group);
  });

  this.onStart(async () => {
    const rootUser = await createRootUserIfMissing(config.auth.rootUser);
    await createAnonymousUserIfMissing(config.auth.anonymousUser, rootUser.uid);
    let adminGroup = await prisma.group.upsert({
      where: { uid: config.auth.adminGroup },
      create: {
        uid: config.auth.adminGroup,
        label: 'admin',
        description: 'Default admin group',
        createdByUid: rootUser.uid,
      },
      update: {},
    });

    const defaultUsers = config.auth.defaultUsers ?? [];
    if (defaultUsers) {
      const adminUsers = await Promise.all(
        defaultUsers.map(async (user: string) => {
          const [username, secret] = user.split('/');
          if (username.trim().length > 0 && secret.trim().length > 0) {
            let authScheme = await findAuthByScheme('local', username);
            if (authScheme == null) {
              const hashedPassword = await bcrypt.hash(secret, 12);
              return createUser(rootUser.uid, 'local', username, hashedPassword);
            } else {
              return authScheme.user;
            }
          }
        })
      );

      await updateGroupMembership(
        rootUser.uid,
        adminGroup.uid,
        adminUsers.map((adminUser) => ({
          action: 'CREATE' as Action,
          userUid: adminUser!.uid,
        }))
      );
    }
  });
}
