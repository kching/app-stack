import { platformPrisma as prisma } from '../../prisma';
import { getLogger } from '../../logger';
import { config } from '../../config';
import bcrypt from 'bcryptjs';
import { Service } from '../../plugin';
import { findAuthByScheme } from './auth';
import { assignPermission, Flags, hasPermission } from './permissions';
import { AccessDeniedError } from '../../errors';
import * as runtime from '../../../../prisma/generated/platformClient/runtime/library';

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

export const findUserByUid = async (callerUid: string, uid: string, enabledUsersOnly = true) => {
  const flags = enabledUsersOnly ? Flags.READ : Flags.READ | Flags.UPDATE;
  const allowed = await hasPermission(callerUid, 'user/*', flags);
  if (allowed) {
    if (enabledUsersOnly) {
      return prisma.user.findUnique({
        where: { uid, enabled: true },
      });
    } else {
      return prisma.user.findUnique({
        where: { uid },
      });
    }
  } else {
    throw new AccessDeniedError(callerUid, 'user/*', flags);
  }
};

export const findAllUsers = async (callerId: string, enabledUsersOnly = true) => {
  const flags = enabledUsersOnly ? Flags.READ : Flags.READ | Flags.UPDATE;
  const allowed = await hasPermission(callerId, 'user/*', flags);

  if (allowed) {
    if (enabledUsersOnly) {
      return prisma.user.findMany({
        where: { enabled: true },
      });
    } else {
      return prisma.user.findMany({});
    }
  } else {
    throw new AccessDeniedError(callerId, 'user/*', flags);
  }
};

export const createUser = async (createdByUid: string, scheme: string, username: string, secret: string) => {
  const allowed = await hasPermission(createdByUid, 'user/*', Flags.CREATE);
  if (allowed) {
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
        const user = await tx.user.create({
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
        await assignPermission(config.auth.rootUser, `user/${user.uid}`, Flags.READ | Flags.UPDATE, `user/${user.uid}`);
        await assignPermission(
          config.auth.rootUser,
          `user/${user.uid}`,
          Flags.CREATE | Flags.READ | Flags.UPDATE,
          `contact/userUid=${user.uid}`
        );
        await assignPermission(
          config.auth.rootUser,
          `user/${user.uid}`,
          Flags.CREATE | Flags.READ | Flags.UPDATE,
          `preference/ownerUid=user:${user.uid}`
        );
        return user;
      } else {
        return exists.user;
      }
    });
  } else {
    throw new AccessDeniedError(createdByUid, 'user/*', Flags.CREATE);
  }
};
export const updateUser = async (
  callerUid: string,
  userUid: string,
  { displayName, enabled, contacts }: UserProfileUpdate
) => {
  const resourceId = `users/${userUid}`;
  const allowed = await hasPermission(callerUid, resourceId, Flags.UPDATE);
  if (allowed) {
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
                  userUid: user.uid,
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
  } else {
    throw new AccessDeniedError(callerUid, resourceId, Flags.UPDATE);
  }
};

export const findGroupByUid = async (
  callerUid: string,
  groupUid: string,
  tx: Omit<typeof prisma, runtime.ITXClientDenyList> = prisma
) => {
  const allowed = await hasPermission(callerUid, `group/${groupUid}`, Flags.READ);
  if (allowed) {
    const group = await tx.group.findUnique({ where: { uid: groupUid } });
    if (group) {
      const membership = await tx.userGroup.findMany({
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
  } else {
    throw new AccessDeniedError(callerUid, `group/${groupUid}`, Flags.READ);
  }
};

export const findAllGroups = async (callerId: string, tx: Omit<typeof prisma, runtime.ITXClientDenyList> = prisma) => {
  const allowed = await hasPermission(callerId, 'group/*', Flags.READ);
  if (allowed) {
    const groups = await tx.group.findMany({});
    return Promise.all(
      groups.map(async (group) => {
        const membership = await tx.userGroup.findMany({
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
      })
    );
  } else {
    throw new AccessDeniedError(callerId, 'group/*', Flags.READ);
  }
};

export const createUserGroup = async (
  callerUid: string,
  label: string,
  description = '',
  tx: Omit<typeof prisma, runtime.ITXClientDenyList> = prisma
) => {
  const resourceId = 'group/*';
  const allowed = await hasPermission(callerUid, resourceId, Flags.CREATE);
  if (allowed) {
    return tx.group.create({
      data: {
        label,
        description,
        createdByUid: callerUid,
      },
    });
  } else {
    throw new AccessDeniedError(callerUid, resourceId, Flags.CREATE);
  }
};

export const updateUserGroup = async (
  callerUid: string,
  groupUid: string,
  attributes: {
    label?: string;
    description?: string;
  },
  tx: Omit<typeof prisma, runtime.ITXClientDenyList> = prisma
) => {
  const resourceId = `group/${groupUid}`;
  const allowed = await hasPermission(callerUid, resourceId, Flags.UPDATE);
  if (allowed) {
    const { label, description } = attributes;
    const group = await tx.group.findUnique({
      where: { uid: groupUid },
    });
    if (group) {
      await tx.group.update({
        where: { uid: groupUid },
        data: {
          label: label,
          description: description,
        },
      });
    }
    return group;
  } else {
    throw new AccessDeniedError(callerUid, resourceId, Flags.UPDATE);
  }
};

export const deleteUserGroup = async (
  callerUid: string,
  groupUid: string,
  tx: Omit<typeof prisma, runtime.ITXClientDenyList> = prisma
) => {
  const resourceId = `group/${groupUid}`;
  const allowed = await hasPermission(callerUid, resourceId, Flags.DELETE);
  if (allowed) {
    return tx.group.delete({
      where: { uid: groupUid },
    });
  } else {
    throw new AccessDeniedError(callerUid, resourceId, Flags.DELETE);
  }
};

export const updateGroupMembership = async (
  callerUid: string,
  groupUid: string,
  memberUpdates: { action: Action; userUid: string }[]
) => {
  const resourceId = `group/${groupUid}`;
  const allowed = await hasPermission(callerUid, resourceId, Flags.UPDATE);
  if (allowed) {
    return prisma.$transaction(async (tx) => {
      const group = await findGroupByUid(callerUid, groupUid);
      if (!group) {
        getLogger('userGroups').error(`addUserToGroup(): Group/${groupUid} not found`);
        throw new Error(`Group/${groupUid} not found`);
      }
      await Promise.allSettled(
        memberUpdates
          .filter(({ userUid }) => userUid != null)
          .map(async ({ action, userUid }) => {
            const user = await tx.user.findUnique({ where: { uid: userUid } });
            if (user) {
              switch (action) {
                case 'CREATE':
                  return tx.userGroup.upsert({
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
                  return tx.userGroup.update({
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
                  return tx.userGroup.delete({
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
  } else {
    throw new AccessDeniedError(callerUid, resourceId, Flags.DELETE);
  }
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
    try {
      const users = await findAllUsers(uid);
      res.status(200).json(users);
    } catch (error) {
      if (error instanceof AccessDeniedError) {
        res.status(401).json({ message: error.message });
      } else {
        res.status(500).end();
      }
    }
  });

  this.useEndpoint('post', '/users', async (req, res) => {
    const user = req.user as { uid: string };
    if (user) {
      const { username, secret, emailAddress } = req.body;
      try {
        const userRecord = await createUser(user.uid, username, secret, emailAddress);
        const contact = await prisma.contact.create({
          data: {
            userId: userRecord.id,
            userUid: userRecord.uid,
            channel: 'email',
            address: emailAddress,
          },
        });
        res.status(200).json({ ...userRecord, contacts: [contact] });
      } catch (error) {
        if (error instanceof AccessDeniedError) {
          res.status(401).json({ message: error.message });
        } else {
          res.status(500).end();
        }
      }
    }
  });

  this.useEndpoint('patch', '/users/:uid', async (req, res) => {
    const callerUid = (req.user as { uid: string })?.uid;
    const { uid } = req.params;
    try {
      const user = await updateUser(callerUid, uid, req.body);
      res.status(200).json(user);
    } catch (error) {
      if (error instanceof AccessDeniedError) {
        res.status(401).json({ message: error.message });
      } else {
        res.status(500).end();
      }
    }
  });

  this.useEndpoint('post', '/groups', async (req, res) => {
    const { uid } = req.user as { uid: string };
    try {
      const group = await createUserGroup(uid, req.body);
      res.status(200).json(group);
    } catch (error) {
      if (error instanceof AccessDeniedError) {
        res.status(401).json({ message: error.message });
      } else {
        res.status(500).end();
      }
    }
  });

  this.useEndpoint('get', '/groups', async (req, res) => {
    const { uid } = req.user as { uid: string };
    try {
      const groups = await findAllGroups(uid);
      res.status(200).json(groups);
    } catch (error) {
      if (error instanceof AccessDeniedError) {
        res.status(401).json({ message: error.message });
      } else {
        res.status(500).end();
      }
    }
  });

  this.useEndpoint('get', '/groups/:uid', async (req, res) => {
    const callerId = (req.user as { uid: string })?.uid;
    const { uid } = req.params;
    try {
      const group = await findGroupByUid(callerId, uid);
      res.status(200).json(group);
    } catch (error) {
      if (error instanceof AccessDeniedError) {
        res.status(401).json({ message: error.message });
      } else {
        res.status(500).end();
      }
    }
  });

  this.useEndpoint('patch', '/groups/:uid', async (req, res) => {
    const callerId = (req.user as { uid: string })?.uid;
    const { uid } = req.params;
    const { label, description, members } = req.body as UserGroupUpdate;
    try {
      const group = prisma.$transaction(async (tx) => {
        const group = await updateUserGroup(callerId, uid, { label, description }, tx);
        if (Array.isArray(members)) {
          await updateGroupMembership(callerId, uid, members);
        }
        return group;
      });
      res.status(200).json(group);
    } catch (error) {
      if (error instanceof AccessDeniedError) {
        res.status(401).json({ message: error.message });
      } else {
        res.status(500).end();
      }
    }
  });

  this.useEndpoint('delete', '/groups:/uid', async (req, res) => {
    const callerId = (req.user as { uid: string })?.uid;
    const { uid } = req.params;
    try {
      const group = await deleteUserGroup(callerId, uid);
      res.status(200).json(group);
    } catch (error) {
      if (error instanceof AccessDeniedError) {
        res.status(401).json({ message: error.message });
      } else {
        res.status(500).end();
      }
    }
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
