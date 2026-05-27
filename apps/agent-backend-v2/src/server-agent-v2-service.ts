import type { createAgentV2Route } from './routes/agent-v2.ts';

type AgentV2Service = Parameters<typeof createAgentV2Route>[0];

export function createServerAgentV2Service(input: {
  agentService: AgentV2Service;
  workspaceService: {
    addWorkspace: NonNullable<AgentV2Service['addWorkspace']>;
    renameWorkspace: NonNullable<AgentV2Service['renameWorkspace']>;
    deleteWorkspace: NonNullable<AgentV2Service['deleteWorkspace']>;
    openWorkspace: NonNullable<AgentV2Service['openWorkspace']>;
    pickFolder: NonNullable<AgentV2Service['pickFolder']>;
    browseFolders: NonNullable<AgentV2Service['browseFolders']>;
    createFolder: NonNullable<AgentV2Service['createFolder']>;
  };
  sessionMetadataService: {
    renameSession: NonNullable<AgentV2Service['renameSession']>;
    deleteSession: NonNullable<AgentV2Service['deleteSession']>;
    markSessionInterrupted: NonNullable<AgentV2Service['markSessionInterrupted']>;
  };
}): AgentV2Service {
  return {
    ...input.agentService,
    addWorkspace: input.workspaceService.addWorkspace,
    renameWorkspace: input.workspaceService.renameWorkspace,
    deleteWorkspace: input.workspaceService.deleteWorkspace,
    openWorkspace: input.workspaceService.openWorkspace,
    pickFolder: input.workspaceService.pickFolder,
    browseFolders: input.workspaceService.browseFolders,
    createFolder: input.workspaceService.createFolder,
    renameSession: input.sessionMetadataService.renameSession,
    deleteSession: input.sessionMetadataService.deleteSession,
    markSessionInterrupted: input.sessionMetadataService.markSessionInterrupted,
  };
}
