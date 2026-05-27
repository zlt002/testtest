import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from '../http/json.ts';
import type {
  PreparedWebMcpLiteUpdate,
  WebMcpLiteUpdateInfo,
} from '../system-update/webmcp-lite-update.ts';

export type SystemUpdateService = {
  getUpdateStatus(): Promise<WebMcpLiteUpdateInfo>;
  prepareUpdate(): Promise<PreparedWebMcpLiteUpdate>;
  launchUpdater(updaterScriptPath: string): void;
};

export function createSystemUpdateRoute(service: SystemUpdateService) {
  return async function handleSystemUpdate(req: IncomingMessage, res: ServerResponse, url: URL) {
    if (url.pathname === '/api/system/update-info') {
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return true;
      }

      try {
        sendJson(res, 200, await service.getUpdateStatus());
      } catch (error) {
        sendJson(res, 200, {
          updateAvailable: false,
          error: error instanceof Error ? error.message : 'Failed to check update',
        });
      }
      return true;
    }

    if (url.pathname === '/api/system/update') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return true;
      }

      try {
        const prepared = await service.prepareUpdate();
        const launchUpdater = () => {
          setTimeout(() => service.launchUpdater(prepared.updaterScriptPath), 10);
        };

        const responseSent = sendJson(res, 200, {
          success: true,
          message:
            'accr Windows Lite 更新包已下载完成，应用将重启并应用更新。',
        });

        if (responseSent) {
          if (res.writableFinished) {
            launchUpdater();
          } else {
            res.once('finish', launchUpdater);
          }
        }
      } catch (error) {
        sendJson(res, 500, {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to prepare update',
        });
      }
      return true;
    }

    return false;
  };
}
