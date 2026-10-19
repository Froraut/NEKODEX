export const AGENT_PYTHON_BUILD_DESCRIPTOR_FILE:'launcher-agent-python-build.json';
export function createAgentPythonBuildDescriptorPublisher(options:{coreHome:string;profile:'production'|'development';control:{endpoint:string;token:string}}):{publish():{instanceId:string};readonly path:string;readonly instanceId:string;snapshot():{instanceId:string}|null};
