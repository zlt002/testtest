import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from '../http/json.ts';
import type { RuntimeCapabilities } from '../runtime-capabilities/runtime-capabilities-service.ts';

function toRuntimeCapabilitiesShape(
  capabilities: RuntimeCapabilities
): Pick<RuntimeCapabilities, 'selectedAuthSource'> {
  return {
    selectedAuthSource: capabilities.selectedAuthSource,
  };
}

export function createRuntimeCapabilitiesRoute(runtimeCapabilitiesService: {
  getCapabilities(): Promise<RuntimeCapabilities>;
  updateCapabilities(patch: Partial<RuntimeCapabilities>): Promise<RuntimeCapabilities>;
}) {
  return async function handleRuntimeCapabilities(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL
  ) {
    if (url.pathname !== '/api/agent-v2/runtime-capabilities') {
      return false;
    }

    if (req.method === 'GET') {
      sendJson(res, 200, {
        success: true,
        capabilities: toRuntimeCapabilitiesShape(
          await runtimeCapabilitiesService.getCapabilities()
        ),
      });
      return true;
    }

    if (req.method === 'PATCH') {
      const body = await readJsonBody<Record<string, unknown>>(req);
      const capabilities = await runtimeCapabilitiesService.updateCapabilities({
        selectedAuthSource:
          body.selectedAuthSource === 'user_claude_settings' ||
          body.selectedAuthSource === 'project_model_config'
            ? body.selectedAuthSource
            : undefined,
      });
      sendJson(res, 200, {
        success: true,
        capabilities: toRuntimeCapabilitiesShape(capabilities),
      });
      return true;
    }

    return false;
  };
}
