import { prisma } from '../prisma';
import { getLogger } from '../logger';

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
export default async function userGroups() {}
