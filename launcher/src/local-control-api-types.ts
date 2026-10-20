import type { LocalControlApiStatus } from '../../src/local-control-api/types';
export type { LocalControlApiStatus };
export interface LocalControlApiAdminApi { request(body: {action:'status'|'enable'|'disable'|'rotate'|'history-consent';consent?:boolean;enabled?:boolean}):Promise<{status:LocalControlApiStatus;tokenCopied?:boolean}> }
