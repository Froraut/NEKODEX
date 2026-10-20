import type {CanonicalNativeHistoryRecorder} from '../canonical-native-history.cjs';
export function registerConversationHistory(input:{
 handle:(channel:string,handler:(...args:any[])=>any)=>void;
 runtimeHost:{supervisor:{readConfig():unknown;ownedRuntimeReady(config:unknown):Promise<boolean>;control(config:unknown,action:string,options:{body:unknown}):Promise<{ok:boolean;value?:unknown;error?:string}>}};
 clipboard:{writeText(text:string):void};
 dialog:{showSaveDialog(options:unknown):Promise<{canceled:boolean;filePath?:string}>};
 canonicalRecorder?:CanonicalNativeHistoryRecorder;
}):void;
