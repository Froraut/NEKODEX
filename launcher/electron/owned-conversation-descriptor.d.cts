import type {OwnedConversationScope} from './owned-conversation-transcript.cjs';
export const OWNED_CONVERSATION_DESCRIPTOR_FILE:'launcher-owned-conversation-history.json';
export function createOwnedConversationDescriptorPublisher(options:{coreHome:string;profile:'production'|'development';control:{endpoint:string;token:string}}):{
  readonly path:string;readonly instanceId:string;
  publish(input?:{scopes?:OwnedConversationScope[];accepting?:boolean}):{instanceId:string;accepting:boolean;scopes:OwnedConversationScope[]};
  snapshot():{instanceId:string;accepting:boolean;scopes:OwnedConversationScope[]}|null;
};
