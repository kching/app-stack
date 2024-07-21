import { platformPrisma as prisma } from '../../prisma';
import { Service } from '../../plugin';
import { config } from '../../config';
import { AccessDeniedError } from '../../errors';

type Action = 'CREATE' | 'DELETE';

type PermissionUpdate = {
  action: Action;
  resource: string;
  flags: number;
};

export enum Flags {
  READ = 0x01,
  CREATE = 0x02,
  UPDATE = 0x04,
  DELETE = 0x08,
  EXECUTE = 0x10,
  ALL = READ | CREATE | UPDATE | DELETE | EXECUTE,
}

export const assignPermission = async (callerUid: string, principal: string, flags: number, resource: string) => {
  const allowed = await hasPermission(callerUid, `permission/resource=${resource}`, Flags.CREATE | Flags.UPDATE);
  if (allowed) {
    const permission = await prisma.permission.findUnique({
      select: {
        flags: true,
      },
      where: {
        searchBy: { principal, resource },
      },
    });
    if (permission) {
      flags &= permission.flags;
    }
    return prisma.permission.upsert({
      where: {
        searchBy: {
          principal: principal,
          resource,
        },
      },
      create: {
        principal: principal,
        resource,
        flags: flags,
      },
      update: {
        flags: flags,
      },
    });
  } else {
    throw new AccessDeniedError(callerUid, `permission/resource=${resource}`, Flags.CREATE | Flags.UPDATE);
  }
};

export const clearPermission = async (callerUid: string, principal: string, flags: number, resource: string) => {
  const allowed = await hasPermission(
    callerUid,
    `permission/resource=${resource}`,
    Flags.CREATE | Flags.UPDATE | Flags.DELETE
  );
  if (allowed) {
    const permission = await prisma.permission.findUnique({
      select: {
        flags: true,
      },
      where: {
        searchBy: { principal, resource },
      },
    });
    if (permission) {
      const newflags = permission.flags & ~flags;
      if (newflags === 0) {
        await prisma.permission.delete({
          where: {
            searchBy: { principal, resource },
          },
        });
      } else {
        await prisma.permission.update({
          where: {
            searchBy: { principal, resource },
          },
          data: {
            flags: flags,
          },
        });
      }
    }
  } else {
    throw new AccessDeniedError(callerUid, resource, Flags.DELETE);
  }
};

export const hasPermission = async (principal: string, resource: string, flags: number) => {
  if (principal === `user:${config.auth.rootUser}`) {
    return true;
  }

  const [resourceType, resourcePath] = resource.split('/');
  const wildcardPermission = await prisma.permission.findUnique({
    where: {
      searchBy: { principal, resource: `${resourceType}/*` },
    },
  });

  if (resourcePath.indexOf('=') > -1) {
    const [attribute, value] = resourcePath.split('=');
    const directPermission = await prisma.permission.findFirst({
      where: {
        principal,
        resource,
        [attribute]: value,
      },
    });
    const principalPermission =
      (directPermission ? directPermission.flags : 0) | (wildcardPermission ? wildcardPermission.flags : 0);
    return (flags & principalPermission) > 0;
  } else {
    const directPermission = await prisma.permission.findUnique({
      where: {
        searchBy: { principal, resource },
      },
    });
    const principalPermission =
      (directPermission ? directPermission.flags : 0) | (wildcardPermission ? wildcardPermission.flags : 0);
    return (flags & principalPermission) > 0;
  }
};

export async function init(this: Service) {
  this.useEndpoint('put', '/users/:uid/permissions', (req, res) => {
    const callerUid = (req.user as { uid: string }).uid;
    const { uid } = req.params;
    const principal = `user:${uid}`;

    if (Array.isArray(req.body)) {
      req.body.map(({ action, resource, flags }: PermissionUpdate) => {
        switch (action) {
          case 'CREATE':
            return assignPermission(callerUid, principal, flags, resource);
          case 'DELETE':
            return clearPermission(callerUid, principal, flags, resource);
        }
      });
    }
  });

  this.onStart(async () => {
    if (config.auth.rootUser && config.auth.adminGroup) {
      const principal = `group:${config.auth.adminGroup}`;
      await assignPermission(config.auth.rootUser, principal, Flags.ALL, 'user/*');
      await assignPermission(config.auth.rootUser, principal, Flags.ALL, 'group/*');
      await assignPermission(config.auth.rootUser, principal, Flags.ALL, 'permission/*');
    }
  });
}
