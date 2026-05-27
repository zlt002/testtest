import { useMemo } from 'react';
import {
  type QueryFunctionContext,
  useQuery,
  type UseQueryOptions,
  type UseQueryResult,
} from '@tanstack/react-query';
import { createAgentV2Client, type AgentV2ClientOptions } from './client';
import type { ProjectSessionRunsResponse } from './types';

const SESSION_RUNS_REFETCH_INTERVAL_MS = 1500;
type AgentV2SessionRunsQueryKey = readonly ['agent-v2', 'session-runs', string];

export function createAgentV2SessionRunsQueryOptions(
  input: AgentV2ClientOptions & {
    projectPath?: string | null;
  }
): UseQueryOptions<
  ProjectSessionRunsResponse,
  Error,
  ProjectSessionRunsResponse,
  AgentV2SessionRunsQueryKey
> {
  const normalizedProjectPath = input.projectPath?.trim() || '';
  const client = createAgentV2Client({
    baseUrl: input.baseUrl,
    endpoint: input.endpoint,
  });

  return {
    queryKey: ['agent-v2', 'session-runs', normalizedProjectPath] as const,
    enabled: normalizedProjectPath.length > 0,
    refetchInterval: normalizedProjectPath.length > 0 ? SESSION_RUNS_REFETCH_INTERVAL_MS : false,
    queryFn: ({ signal }: QueryFunctionContext<AgentV2SessionRunsQueryKey>) =>
      client.listProjectSessionRuns(normalizedProjectPath, { signal }),
  };
}

export function useAgentV2SessionRuns(
  input: AgentV2ClientOptions & {
    projectPath?: string | null;
  }
): UseQueryResult<ProjectSessionRunsResponse, Error> {
  const queryOptions = useMemo(
    () => createAgentV2SessionRunsQueryOptions(input),
    [input.baseUrl, input.endpoint, input.projectPath]
  );

  return useQuery(queryOptions);
}
