import type { ToolScope } from '../../src/agent-tools/types';
import type { PythonBuildSelection } from '../../src/execution-environments/python-build';
export interface PythonBuildSelectionFile { role:'source'|'source-archive'|'build-wheel'|'runtime-wheel'; path:string; sha256:string; bytes:number }
export interface PythonBuildSelectionHeader { version:1; selectionId:string; scope:ToolScope; config:Omit<PythonBuildSelection,'source'|'buildWheels'|'runtimeWheels'>; sourceKind:'tree'|'zip'|'tar.gz'; files:PythonBuildSelectionFile[]; snapshotDigest:string; instanceId:string }
export const PYTHON_BUILD_SELECTION_LIMITS:{readonly bytes:number;readonly fileBytes:number;readonly files:number;readonly headerBytes:number;readonly requestBytes:number};
export function parsePythonBuildScope(scope:unknown):ToolScope;
export function parsePythonBuildConfig(config:unknown):PythonBuildSelectionHeader['config'];
export function parsePythonBuildSelectionRequest(raw:unknown):{selectionId:string;scope:ToolScope};
export function parsePythonBuildSelectionHeader(raw:unknown):PythonBuildSelectionHeader;
export function selectionDigest(header:unknown):string;
export function safePythonBuildPath(path:unknown):string;
