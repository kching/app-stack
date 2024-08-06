import { Service } from '../plugin';
import { platformPrisma as prisma } from '../prisma';
import { publish } from '../events';
import { SecurityContext, Permissions } from '../accessControl';
import { AccessDeniedError } from '../errors';
import { UserContext } from './userManagement/auth';

type Preference = {
  namespace: string;
  attribute: string;
  value?: string;
};

type PrefsUpdate = {
  action: 'UPDATE' | 'DELETE';
  preference: Preference;
};

export const getPreferenceValue = async (
  ownerUid: string,
  namespace: string,
  attribute: string
): Promise<string | number | object | boolean | null> => {
  const pref = await prisma.preference.findUnique({
    where: {
      ownerUid_namespace_attribute: {
        ownerUid,
        namespace,
        attribute,
      },
    },
  });

  if (pref) {
    const { type, value } = pref;
    switch (type) {
      case 'number':
        return Number.parseFloat(value);
      case 'boolean':
        return value === 'true' || value === '1';
      case 'json':
        return JSON.parse(value);
      default:
        return value;
    }
  } else {
    return null;
  }
};

export const getPreferences = async (securityContext: SecurityContext, ownerUid: string, namespace: string) => {
  const resource = `preference/[ownerUid="${ownerUid}"]`;
  const allowed = await securityContext.hasPermissions(Permissions.READ, resource);
  if (allowed) {
    return prisma.preference.findMany({
      where: {
        ownerUid,
        namespace,
      },
    });
  } else {
    throw new AccessDeniedError(securityContext, resource, Permissions.READ);
  }
};

export const updatePreference = async (
  securityContext: SecurityContext,
  ownerUid: string,
  { action, preference }: PrefsUpdate
) => {
  const resource = `preference/[ownerUid="${ownerUid}"]`;
  const allowed = await securityContext.hasPermissions(
    Permissions.CREATE | Permissions.UPDATE | Permissions.DELETE,
    resource
  );
  if (allowed) {
    const { namespace, attribute, value } = preference;
    if (action === 'UPDATE') {
      let strValue;
      switch (typeof value) {
        case 'number':
          strValue = Number(value).toString();
          break;
        case 'boolean':
          strValue = Boolean(value).toString();
          break;
        case 'object':
          strValue = JSON.stringify(value);
          break;
        default:
          strValue = String(value);
      }
      return prisma.preference.upsert({
        where: {
          ownerUid_namespace_attribute: {
            ownerUid,
            namespace,
            attribute,
          },
        },
        create: {
          ownerUid,
          namespace,
          attribute,
          type: typeof value,
          value: strValue,
        },
        update: {
          ownerUid,
          namespace,
          attribute,
          type: typeof value,
          value: strValue,
        },
      });
    } else if (action === 'DELETE') {
      const preference = await prisma.preference.delete({
        where: {
          ownerUid_namespace_attribute: {
            ownerUid,
            namespace,
            attribute,
          },
        },
      });
      publish('resource.preference', { status: 'UPDATED', resourceId: preference.uid });
      return preference;
    }
  }
};

export async function init(this: Service) {
  this.useEndpoint('get', '/users/:uid/prefs', async (req, res) => {
    const userContext = req.user as UserContext;
    const { uid } = req.params;
    try {
      if (userContext) {
        const ownerUid = `user/${uid}`;
        const { namespace } = req.query as { namespace: string };
        const prefs = await getPreferences(userContext.securityContext, ownerUid, namespace);
        res.status(200).json(prefs);
      } else {
        res.status(401).end();
      }
    } catch (error) {
      if (error instanceof AccessDeniedError) {
        res.status(401).end();
      } else {
        res.status(500);
      }
    }
  });
  this.useEndpoint('patch', '/users/:uid', async (req, res) => {
    const securityContext = (req.user as UserContext).securityContext;
    if (securityContext) {
      try {
        const { uid } = req.params;
        if (Array.isArray(req.body as PrefsUpdate[])) {
          req.body.map((prefsUpdate: PrefsUpdate) => {
            updatePreference(securityContext, `user/${uid}`, prefsUpdate);
          });
        }
      } catch (error) {
        if (error instanceof AccessDeniedError) {
          res.status(401).end();
        } else {
          res.status(500).end();
        }
      }
    } else {
      res.status(401).end();
    }
  });
  this.useEndpoint('get', '/groups/:uid/prefs', async (req, res) => {
    const securityContext = (req.user as UserContext).securityContext;
    const { uid } = req.params;
    const { namespace } = req.query as { namespace: string };
    const prefs = await getPreferences(securityContext, `user/${uid}`, namespace);
    res.status(200).json(prefs);
  });
  this.useEndpoint('patch', '/groups/:uid', async (req, res) => {
    const securityContxt = (req.user as UserContext).securityContext;
    const { uid } = req.params;
    if (Array.isArray(req.body as PrefsUpdate[])) {
      req.body.map((prefsUpdate: PrefsUpdate) => {
        updatePreference(securityContxt, `group/${uid}`, prefsUpdate);
      });
    }
    res.status(200).end();
  });
}
