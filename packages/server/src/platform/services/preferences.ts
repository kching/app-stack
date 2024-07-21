import { Service } from '../plugin';
import { platformPrisma as prisma } from '../prisma';
import { Flags, hasPermission } from './userManagement/permissions';
import { publish } from '../events';

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

export const getPreferences = async (callerId: string, ownerUid: string, namespace: string) => {
  // TODO: check permissions
  return prisma.preference.findMany({
    where: {
      ownerUid,
      namespace,
    },
  });
};

export const updatePreference = async (callerId: string, ownerUid: string, { action, preference }: PrefsUpdate) => {
  // TODO: check for permissions
  const allowed = await hasPermission(
    callerId,
    `preference/ownerUid=${ownerUid}`,
    Flags.CREATE | Flags.UPDATE | Flags.DELETE
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
    const callerUid = (req.user as { uid: string }).uid;
    const { uid } = req.params;
    const ownerUid = `user:${uid}`;
    const { namespace } = req.query as { namespace: string };
    const prefs = await getPreferences(callerUid, ownerUid, namespace);
    res.status(200).json(prefs);
  });
  this.useEndpoint('patch', '/users/:uid', async (req, res) => {
    const callUid = (req.user as { uid: string })?.uid;
    const { uid } = req.params;
    const ownerUid = `user:${uid}`;
    if (Array.isArray(req.body as PrefsUpdate[])) {
      req.body.map((prefsUpdate: PrefsUpdate) => {
        updatePreference(callUid, ownerUid, prefsUpdate);
      });
    }
    res.status(200).end();
  });
  this.useEndpoint('get', '/groups/:uid/prefs', async (req, res) => {
    const callerUid = (req.user as { uid: string }).uid;
    const { uid } = req.params;
    const ownerUid = `group:${uid}`;
    const { namespace } = req.query as { namespace: string };
    const prefs = await getPreferences(callerUid, ownerUid, namespace);
    res.status(200).json(prefs);
  });
  this.useEndpoint('patch', '/groups/:uid', async (req, res) => {
    const callUid = (req.user as { uid: string })?.uid;
    const { uid } = req.params;
    const ownerUid = `group:${uid}`;
    if (Array.isArray(req.body as PrefsUpdate[])) {
      req.body.map((prefsUpdate: PrefsUpdate) => {
        updatePreference(callUid, ownerUid, prefsUpdate);
      });
    }
    res.status(200).end();
  });
}
