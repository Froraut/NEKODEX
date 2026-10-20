import type {ToolScope} from '../../src/agent-tools/types';
import type {PythonBuildSelectionHeader} from './python-build-selection-contract.cjs';
export function createPythonBuildSelectionService(options:{assertScope(scope:ToolScope):unknown|Promise<unknown>}):{
 register(scope:ToolScope,input:{source:{kind:'tree'|'zip'|'tar.gz';path:string};buildWheelPaths?:string[];runtimeWheelPaths?:string[];config:PythonBuildSelectionHeader['config']},explicitUserAction:boolean):Promise<{selectionId:string;name:string;version:string;sourceKind:string;sourceFileCount:number;buildWheelCount:number;runtimeWheelCount:number;bytes:number;snapshotDigest:string;excludedEntries:number}>;
 open(request:unknown):Promise<{header:Omit<PythonBuildSelectionHeader,'instanceId'>;chunks:Uint8Array[];assertCurrent():Promise<void>}>;
 revoke(selectionId:string):void;close():void;
};
