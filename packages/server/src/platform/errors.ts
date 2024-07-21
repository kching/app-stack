export class AccessDeniedError extends Error {
  readonly callerUid: string;
  readonly resource: string;
  readonly permissionsRequested: number;

  constructor(callerUid: string, resource: string, permissionRequested: number) {
    super(
      `${callerUid} does not have permission(0x${permissionRequested.toString(16)}) to access resource ${resource}`
    );
    this.callerUid = callerUid;
    this.resource = resource;
    this.permissionsRequested = permissionRequested;
  }
}
