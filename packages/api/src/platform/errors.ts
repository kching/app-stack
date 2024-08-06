import { SecurityContext } from './accessControl';

export class AccessDeniedError extends Error {
  readonly securityContext: SecurityContext;
  readonly resource: string;
  readonly permissionsRequested: number;

  constructor(securtiyContext: SecurityContext, resource: string, permissionRequested: number) {
    super(
      `${securtiyContext.principalUid} does not have permission(0x${permissionRequested.toString(16)}) to access resource ${resource}`
    );
    this.securityContext = securtiyContext;
    this.resource = resource;
    this.permissionsRequested = permissionRequested;
  }
}
