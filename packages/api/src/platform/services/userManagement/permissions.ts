import { platformPrisma as prisma } from '../../prisma';
import { Service } from '../../plugin';
import { config } from '../../config';
import { AccessDeniedError } from '../../errors';
import { publish } from '../../events';
import { Permissions, SecurityContext } from '../../accessControl';
import { ResourcePath } from '../../resources';
import { UserContext } from './auth';

type Action = 'CREATE' | 'DELETE';

type PermissionUpdate = {
  action: Action;
  resource: string;
  permissions: number;
};

export const assignPermission = async (
  securityContext: SecurityContext,
  principal: string,
  resource: string,
  permissions: number
) => {
  const allowed = await securityContext.hasPermissions(
    Permissions.CREATE | Permissions.UPDATE,
    new ResourcePath(`securityPolicy/[resource="${resource}"]`)
  );
  if (allowed) {
    let policy = await prisma.securityPolicy.findUnique({
      where: {
        principal_resource: { principal, resource },
      },
    });
    if (policy) {
      permissions &= policy.permissions;
    }
    policy = await prisma.securityPolicy.upsert({
      where: {
        principal_resource: {
          principal,
          resource,
        },
      },
      create: {
        principal: principal,
        resource,
        permissions,
      },
      update: {
        permissions,
      },
    });
    publish('resource.securityPolicy', { status: 'UPDATED', resourceId: policy.uid });
    return policy;
  } else {
    throw new AccessDeniedError(
      securityContext,
      `securityPolicy/resource=${resource}`,
      Permissions.CREATE | Permissions.UPDATE
    );
  }
};

export const clearPermission = async (
  securityContext: SecurityContext,
  principal: string,
  resource: string,
  permissions: number
) => {
  const allowed = await securityContext.hasPermissions(
    Permissions.DELETE | Permissions.UPDATE,
    new ResourcePath(`securityPolicy/[resource="${resource}"]`)
  );
  if (allowed) {
    let policy = await prisma.securityPolicy.findUnique({
      where: {
        principal_resource: { principal, resource },
      },
    });
    if (policy) {
      permissions = policy.permissions & ~permissions;
      if (permissions === 0) {
        await prisma.securityPolicy.delete({
          where: {
            principal_resource: { principal, resource },
          },
        });
      } else {
        await prisma.securityPolicy.update({
          where: {
            principal_resource: { principal, resource },
          },
          data: {
            permissions,
          },
        });
      }
      publish('resource.permission', { status: 'DELETED', resourceId: policy.uid });
    }
  } else {
    throw new AccessDeniedError(securityContext, resource, Permissions.DELETE | Permissions.UPDATE);
  }
};

export async function init(this: Service) {
  this.useEndpoint('put', '/users/:userUid/permissions', async (req, res) => {
    const { userUid } = req.params;
    const securityContext = (req.user as UserContext).securityContext;

    try {
      if (Array.isArray(req.body)) {
        await Promise.all(
          req.body.map(({ action, resource, permissions }: PermissionUpdate) => {
            switch (action) {
              case 'CREATE':
                return assignPermission(securityContext, userUid, resource, permissions);
              case 'DELETE':
                return clearPermission(securityContext, userUid, resource, permissions);
            }
          })
        );
        res.status(200).end();
      }
    } catch (error) {
      res.status(401).end();
    }
  });

  this.onStart(async () => {
    if (config.auth.rootUser && config.auth.adminGroupUid) {
      const principal = `group/${config.auth.adminGroupUid}`;
      const securityContext = new SecurityContext(config.auth.rootUser);
      await assignPermission(securityContext, principal, 'user/*', Permissions.ALL);
      await assignPermission(securityContext, principal, 'group/*', Permissions.ALL);
      await assignPermission(securityContext, principal, 'securityPolicy/*', Permissions.ALL);
    }
  });
}
