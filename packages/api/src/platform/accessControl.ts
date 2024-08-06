import { platformPrisma as prisma } from './prisma';
import { ResourceLike, ResourcePath } from './resources';
import { config } from './config';

export enum Permissions {
  CREATE = 0x01,
  READ = 0x02,
  UPDATE = 0x04,
  DELETE = 0x08,
  EXECUTE = 0x10,
  ALL = CREATE | READ | UPDATE | DELETE | EXECUTE,
}

class PolicyNode {
  private readonly _resourcePath: ResourcePath;
  private _children: PolicyNode[] = [];
  private _permissions: number = 0;

  constructor(resourcePath: ResourcePath) {
    this._resourcePath = resourcePath;
  }
  get resourceType() {
    return this._resourcePath.type;
  }
  get resourcePath() {
    return this._resourcePath;
  }
  get permissions() {
    return this._permissions;
  }
  get children() {
    return this._children;
  }
  accept(resourcePath: ResourcePath, permission: number) {
    if (resourcePath.isWildcard) {
      this._permissions |= permission;
    } else {
      let childNode = this._children.find((child) => child.resourcePath.path === resourcePath.path);
      if (!childNode) {
        childNode = new PolicyNode(resourcePath);
        this._children.push(childNode);
      }
      childNode._permissions |= permission;
    }
  }
  matches(resourcePath: ResourcePath, resource?: ResourceLike) {
    if (this._resourcePath.type === resourcePath.type) {
      if (this._resourcePath.isWildcard) {
        return true;
      }
      if (this._resourcePath.uid != null && this._resourcePath.uid === resourcePath.uid) {
        return true;
      }
      if (this._resourcePath.filter && resource) {
        const [attributeName, value] = this._resourcePath.filter;
        return resource[attributeName] === value;
      }
    }
    return false;
  }
}

type SecurityPolicyRecord = {
  id: number;
  uid: string;
  principal: string;
  resource: string;
  permissions: number;
};

export class SecurityContext {
  private readonly _principal: string;
  private readonly policies: Promise<PolicyNode[]>;

  get principalUid() {
    return this._principal;
  }

  constructor(principalUid: string) {
    this._principal = principalUid;
    this.policies = this.loadPolicies(principalUid).then((policyRecords: SecurityPolicyRecord[]) => {
      const policyNodes = policyRecords.reduce((policyNodes, policyRecord) => {
        const resourcePath = new ResourcePath(policyRecord.resource);
        let typeNode = policyNodes.find((p) => p.resourceType === resourcePath.type);
        if (!typeNode) {
          typeNode = new PolicyNode(new ResourcePath(`${resourcePath.type}/*`));
          policyNodes.push(typeNode);
        }
        typeNode.accept(resourcePath, policyRecord.permissions);
        return policyNodes;
      }, [] as PolicyNode[]);
      return Promise.resolve(policyNodes);
    });
  }

  /**
   *
   * @param principalUid either user/{uid} or group/{groupId}
   * @private
   */
  private async loadPolicies(principalUid: string): Promise<SecurityPolicyRecord[]> {
    let policies = await prisma.securityPolicy.findMany({
      where: {
        principal: principalUid,
      },
    });

    if (principalUid.startsWith('user/')) {
      const [, uid] = principalUid.split('/');
      const groups = await prisma.userGroup.findMany({
        include: {
          group: true,
        },
        where: {
          user: {
            uid,
          },
        },
      });
      const groupIds = groups.map((group) => `group/${group.uid}`);
      policies = await groupIds.reduce(async (allPolicies, groupId) => {
        const groupPolicies = await this.loadPolicies(groupId);
        return (await allPolicies).concat(groupPolicies);
      }, Promise.resolve(policies));
    }
    return policies;
  }

  async hasPermissions(permissions: number, resource: ResourceLike | ResourcePath | string) {
    if (this.principalUid === config.auth.rootUser) {
      return true;
    }
    let resourcePath: ResourcePath;
    if (typeof resource === 'string') {
      resourcePath = new ResourcePath(resource);
    }
    if (resource instanceof ResourcePath) {
      resourcePath = resource;
      const typeNode = (await this.policies).find((policyNode) => policyNode.matches(resourcePath));
      if (typeNode) {
        let allowedPermissions = typeNode.permissions;
        typeNode.children.forEach((policyNode) => {
          if (policyNode.matches(resourcePath)) {
            allowedPermissions |= policyNode.permissions;
          }
        });
        return (allowedPermissions & permissions) > 0;
      }
    } else {
      const resourceLike = resource as ResourceLike;
      const resourcePath = new ResourcePath(`${resourceLike.resourceType}/${resourceLike.uid}`);
      const typeNode = (await this.policies).find((policyNode) => policyNode.matches(resourcePath, resourceLike));
      let allowedPermissions = 0;
      if (typeNode) {
        allowedPermissions = typeNode.permissions;
        typeNode.children.forEach((policyNode) => {
          if (policyNode.matches(resourcePath, resourceLike)) {
            allowedPermissions |= policyNode.permissions;
          }
        });
        return (allowedPermissions & permissions) > 0;
      }
    }
  }
}
