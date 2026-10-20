import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { lstatSync, mkdirSync, chmodSync } from "node:fs";
import { join, resolve } from "node:path";
import { snapshotFile, writeFileSnapshot, type FileSnapshot } from "../file-transactions";
import type { LocalControlApiStatus } from "./types";
interface Policy { version: 1; enabled: boolean; tokenHash: string | null; historyContent: boolean }
const hash = (text:string) => createHash("sha256").update(text).digest("hex");
const defaults = (): Policy => ({version:1,enabled:false,tokenHash:null,historyContent:false});
export const READ_TOKEN_PATTERN = /^nk-read-[a-f0-9]{64}$/;
/** No raw credential is ever persisted. A lost token is replaced by explicit rotation. */
export class LocalControlApiPolicy {
  readonly path: string;
  constructor(coreHome: string) {
    if (!coreHome?.trim()) throw new Error("Explicit API coreHome required");
    this.path = join(resolve(coreHome),"local-control-api","policy.json");
  }
  private load(): {state:Policy;before:FileSnapshot} {
    const directory=lstatSync(resolve(this.path,".."),{throwIfNoEntry:false});
    if (directory && (!directory.isDirectory() || directory.isSymbolicLink() || (process.platform!=="win32" && ((directory.mode&0o077)!==0 || (process.getuid && directory.uid!==process.getuid()))))) throw new Error("Unsafe local API policy directory");
    const stat=lstatSync(this.path,{throwIfNoEntry:false});
    if (!stat) { const before=snapshotFile(this.path); if(before.exists)throw new Error("Local API policy changed during read"); return {state:defaults(),before}; }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size>4096 || (process.platform!=="win32" && ((stat.mode&0o077)!==0 || (process.getuid && stat.uid!==process.getuid())))) throw new Error("Unsafe local API policy file");
    const before=snapshotFile(this.path);
    if(before.identity?.dev!==stat.dev || before.identity?.ino!==stat.ino || before.mode!== (stat.mode&0o777)) throw new Error("Local API policy changed during read");
    const value=JSON.parse(before.data!.toString("utf8")) as Policy;
    if (value?.version!==1 || typeof value.enabled!=="boolean" || typeof value.historyContent!=="boolean" || !(value.tokenHash===null || typeof value.tokenHash==="string" && /^[a-f0-9]{64}$/.test(value.tokenHash)) || value.enabled && !value.tokenHash) throw new Error("Invalid local API policy");
    return {state:{version:1,enabled:value.enabled,tokenHash:value.tokenHash,historyContent:value.historyContent},before};
  }
  private present(state:Policy): LocalControlApiStatus {
    return {apiVersion:"1",enabled:state.enabled,credentialConfigured:state.tokenHash!==null,historyContent:state.historyContent,
      permissions:["status:read","tasks:metadata:read","agent-tasks:metadata:read","history:coverage:read",...(state.historyContent?["history:content:read"]:[])],policyPath:this.path};
  }
  status():LocalControlApiStatus {return this.present(this.load().state);}
  /** Credential and permission scope come from one immutable policy read. */
  admit(token:string):LocalControlApiStatus|undefined {
    const {state}=this.load(); if(!state.enabled || !state.tokenHash || !READ_TOKEN_PATTERN.test(token)) return undefined;
    return timingSafeEqual(Buffer.from(state.tokenHash,"hex"),Buffer.from(hash(token),"hex"))?this.present(state):undefined;
  }
  authenticate(token:string): boolean {return this.admit(token)!==undefined;}
  change(action:"enable"|"disable"|"rotate"|"history-consent", options:{consent?:boolean;enabled?:boolean}={}): {status:LocalControlApiStatus;readToken?:string} {
    // Read/validate before mkdir/chmod so an existing unsafe object is never silently repaired.
    const {state,before}=this.load();
    let readToken:string|undefined;
    if(action==="enable") {
      if(options.consent!==true) throw new Error("Explicit read-only API consent required");
      if(!state.enabled) {readToken=`nk-read-${randomBytes(32).toString("hex")}`;state.tokenHash=hash(readToken);state.enabled=true;state.historyContent=false;}
    } else if(action==="rotate") {
      if(!state.enabled || options.consent!==true) throw new Error("Enable the API and explicitly confirm credential rotation");
      readToken=`nk-read-${randomBytes(32).toString("hex")}`;state.tokenHash=hash(readToken);
    } else if(action==="disable") {state.enabled=false;state.historyContent=false;}
    else {
      if(typeof options.enabled!=="boolean" || options.enabled && (!state.enabled || options.consent!==true)) throw new Error("Separate history-content consent requires an enabled API");
      state.historyContent=options.enabled;
    }
    const directory=resolve(this.path,"..");mkdirSync(directory,{recursive:true,mode:0o700});if(process.platform!=="win32")chmodSync(directory,0o700);
    writeFileSnapshot(before,JSON.stringify(state)+"\n",{expectedSnapshot:before});
    return {status:this.status(),...(readToken?{readToken}:{})};
  }
}
