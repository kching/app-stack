import { platformPrisma as prisma } from '../../prisma';
import { getLogger } from '../../logger';
import { config } from '../../config';
import bcrypt from 'bcryptjs';
import { Service } from '../../plugin';
import { findAuthByScheme, UserContext } from './auth';
import { AccessDeniedError } from '../../errors';
import * as runtime from '../../../../prisma/generated/platformClient/runtime/library';
import { publish } from '../../events';
import { Permissions, SecurityContext } from '../../accessControl';
import { assignPermission } from './permissions';
import { subscribeContactToEvent } from '../notifications';

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

export const findUserByUid = async (securityContext: SecurityContext, uid: string, enabledUsersOnly = true) => {
  const requiredPermissions = enabledUsersOnly ? Permissions.READ : Permissions.READ | Permissions.UPDATE;
  const allowed = await securityContext.hasPermissions(requiredPermissions, 'user/*');
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
    throw new AccessDeniedError(securityContext, 'user/*', requiredPermissions);
  }
};

export const findAllUsers = async (securityContext: SecurityContext, enabledUsersOnly = true) => {
  const requiredPermissions = enabledUsersOnly ? Permissions.READ : Permissions.READ | Permissions.UPDATE;
  const allowed = await securityContext.hasPermissions(requiredPermissions, 'user/*');
  if (allowed) {
    if (enabledUsersOnly) {
      return prisma.user.findMany({
        where: { enabled: true },
      });
    } else {
      return prisma.user.findMany({});
    }
  } else {
    throw new AccessDeniedError(securityContext, 'user/*', requiredPermissions);
  }
};

export const createUser = async (
  securityContext: SecurityContext,
  scheme: string,
  username: string,
  emailAddress: string,
  secret: string
) => {
  const createUserAllowed = await securityContext.hasPermissions(Permissions.CREATE, 'user/*');
  const assignPermissionsAllowed = await securityContext.hasPermissions(Permissions.UPDATE, 'permission/*');
  if (createUserAllowed && assignPermissionsAllowed) {
    const user = await prisma.$transaction(async (tx) => {
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
            createdByUid: securityContext.principalUid,
          },
        });
        await tx.contact.create({
          data: {
            userId: user.id,
            ownerUid: user.uid,
            channel: 'email',
            address: emailAddress,
            primary: true,
          },
        });
        return user;
      } else {
        return exists.user;
      }
    });

    const contact = await prisma.contact.findFirst({
      where: {
        ownerUid: user.uid,
        channel: 'email',
        primary: true,
      },
    });
    if (contact) {
      await subscribeContactToEvent(securityContext, contact.uid, 'forgotPassword');
    }

    await assignPermission(
      securityContext,
      `user/${user.uid}`,
      `user/${user.uid}`,
      Permissions.READ | Permissions.UPDATE
    );
    await assignPermission(securityContext, `user/${user.uid}`, `contact/[ownerUid=${user.uid}]`, Permissions.ALL);
    await assignPermission(securityContext, `user/${user.uid}`, `subscription/[ownerUid=${user.uid}`, Permissions.ALL);
    await assignPermission(
      securityContext,
      `user/${user.uid}`,
      `preference/[ownerUid=user:${user.uid}]`,
      Permissions.ALL
    );
    publish('resource.user', { status: 'CREATED', resource: user.uid });
    return user;
  } else {
    if (!createUserAllowed) throw new AccessDeniedError(securityContext, 'user/*', Permissions.CREATE);
    if (!assignPermissionsAllowed)
      throw new AccessDeniedError(securityContext, 'securityPolicy/*', Permissions.CREATE | Permissions.UPDATE);
  }
};

export const updateUser = async (
  securityContext: SecurityContext,
  userUid: string,
  { displayName, enabled, contacts }: UserProfileUpdate
) => {
  const resourceId = `users/${userUid}`;
  const allowed = await securityContext.hasPermissions(Permissions.UPDATE, resourceId);
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
      publish('resource.user', { status: 'UPDATED', resourceId: user.uid });
      if (user && Array.isArray(contacts)) {
        await Promise.all(
          contacts.map(async ({ action, uid, channel, address }) => {
            if (action === 'CREATE') {
              const contact = await tx.contact.create({
                data: {
                  userId: user.id,
                  ownerUid: user.uid,
                  channel,
                  address,
                },
              });
              publish('resource.contact', { status: 'CREATED', resource: contact.uid });
              return contact;
            } else if (action === 'UPDATE') {
              const contact = await tx.contact.update({
                where: {
                  uid,
                },
                data: {
                  channel,
                  address,
                },
              });
              publish('resource.contact', { status: 'UPDATED', resource: contact.uid });
              return contact;
            } else if (action === 'DELETE') {
              const contact = await tx.contact.delete({
                where: {
                  uid,
                },
              });
              publish('resource.contact', { status: 'DELETED', resource: contact.uid });
              return contact;
            }
          })
        );
      }
    });
  } else {
    throw new AccessDeniedError(securityContext, resourceId, Permissions.UPDATE);
  }
};

export const findGroupByUid = async (
  securityContext: SecurityContext,
  groupUid: string,
  tx: Omit<typeof prisma, runtime.ITXClientDenyList> = prisma
) => {
  const allowed = await securityContext.hasPermissions(Permissions.READ, 'group/*');
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
    throw new AccessDeniedError(securityContext, `group/${groupUid}`, Permissions.READ);
  }
};

export const findAllGroups = async (
  securityContext: SecurityContext,
  tx: Omit<typeof prisma, runtime.ITXClientDenyList> = prisma
) => {
  const allowed = await securityContext.hasPermissions(Permissions.READ, 'group/*');
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
    throw new AccessDeniedError(securityContext, 'group/*', Permissions.READ);
  }
};

export const createUserGroup = async (
  securityContext: SecurityContext,
  label: string,
  description = '',
  tx: Omit<typeof prisma, runtime.ITXClientDenyList> = prisma
) => {
  const resourceId = 'group/*';
  const allowed = await securityContext.hasPermissions(Permissions.CREATE, 'group/*');
  if (allowed) {
    const group = await tx.group.create({
      data: {
        label,
        description,
        createdByUid: securityContext.principalUid,
      },
    });
    publish('resource.group', { status: 'CREATED', resourceId: group.uid });
  } else {
    throw new AccessDeniedError(securityContext, resourceId, Permissions.CREATE);
  }
};

export const updateUserGroup = async (
  securityContext: SecurityContext,
  groupUid: string,
  attributes: {
    label?: string;
    description?: string;
  },
  tx: Omit<typeof prisma, runtime.ITXClientDenyList> = prisma
) => {
  const resourceId = `group/${groupUid}`;
  const allowed = await securityContext.hasPermissions(Permissions.UPDATE, resourceId);
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
      publish('resource.group', { status: 'UPDATED', resourceId: group.uid });
    }
    return group;
  } else {
    throw new AccessDeniedError(securityContext, resourceId, Permissions.UPDATE);
  }
};

export const deleteUserGroup = async (
  securityContext: SecurityContext,
  groupUid: string,
  tx: Omit<typeof prisma, runtime.ITXClientDenyList> = prisma
) => {
  const resourceId = `group/${groupUid}`;
  const allowed = await securityContext.hasPermissions(Permissions.DELETE, resourceId);
  if (allowed) {
    const group = await tx.group.delete({
      where: { uid: groupUid },
    });
    publish('resource.group', { status: 'DELETED', resourceId: groupUid });
    return group;
  } else {
    throw new AccessDeniedError(securityContext, resourceId, Permissions.DELETE);
  }
};

export const updateGroupMembership = async (
  securityContext: SecurityContext,
  groupUid: string,
  memberUpdates: { action: Action; userUid: string }[]
) => {
  const resourceId = `group/${groupUid}`;
  const allowed = await securityContext.hasPermissions(Permissions.UPDATE, resourceId);
  if (allowed) {
    return prisma.$transaction(async (tx) => {
      const group = await findGroupByUid(securityContext, groupUid);
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
                      createdByUId: securityContext.principalUid,
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
      publish('resource.group', { status: 'UPDATED', resourceId: group.uid });
    });
  } else {
    throw new AccessDeniedError(securityContext, resourceId, Permissions.DELETE);
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
  const rootSecurityContext = new SecurityContext(config.auth.rootUser);

  this.useEndpoint('get', '/users', async (req, res) => {
    const securityContext = (req.user as UserContext).securityContext;

    try {
      if (securityContext) {
        const users = await findAllUsers(securityContext);
        res.status(200).json(users);
      } else {
        res.status(401).end();
      }
    } catch (error) {
      if (error instanceof AccessDeniedError) {
        res.status(401).json({ message: error.message });
      } else {
        res.status(500).end();
      }
    }
  });

  this.useEndpoint('post', '/users', async (req, res) => {
    const securityContext = (req.user as UserContext)?.securityContext;
    if (securityContext) {
      const { username, secret, emailAddress } = req.body;
      try {
        const userRecord = await createUser(securityContext, username, secret, emailAddress);
        if (userRecord) {
          res.status(200).json({ ...userRecord });
        } else {
          res.status(500).end();
        }
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
    const securityContext = (req.user as UserContext)?.securityContext;

    const { uid } = req.params;
    try {
      const user = await updateUser(securityContext, uid, req.body);
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
    const securityContext = (req.user as UserContext)?.securityContext;
    try {
      const group = await createUserGroup(securityContext, req.body);
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
    const securityContext = (req.user as UserContext)?.securityContext;
    try {
      const groups = await findAllGroups(securityContext);
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
    const securityContext = (req.user as UserContext)?.securityContext;
    const { uid } = req.params;
    try {
      const group = await findGroupByUid(securityContext, uid);
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
    const securityContext = (req.user as UserContext)?.securityContext;
    const { uid } = req.params;
    const { label, description, members } = req.body as UserGroupUpdate;
    try {
      const group = prisma.$transaction(async (tx) => {
        const group = await updateUserGroup(securityContext, uid, { label, description }, tx);
        if (Array.isArray(members)) {
          await updateGroupMembership(securityContext, uid, members);
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
    const securityContext = (req.user as UserContext)?.securityContext;
    const { uid } = req.params;
    try {
      const group = await deleteUserGroup(securityContext, uid);
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
      where: { uid: config.auth.adminGroupUid },
      create: {
        uid: config.auth.adminGroupUid,
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
              return createUser(rootSecurityContext, 'local', username, hashedPassword);
            } else {
              return authScheme.user;
            }
          }
        })
      );

      await updateGroupMembership(
        rootSecurityContext,
        adminGroup.uid,
        adminUsers.map((adminUser) => ({
          action: 'CREATE' as Action,
          userUid: adminUser!.uid,
        }))
      );
    }
  });
}
