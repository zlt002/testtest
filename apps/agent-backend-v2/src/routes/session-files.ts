import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from '../http/json.ts';
import { matchPath } from '../http/router.ts';
import { HttpError } from '../shared/errors.ts';
import type { createSessionFileService } from '../session-files/session-file-service.ts';

type SessionFileService = ReturnType<typeof createSessionFileService>;

type UploadBody = {
  sessionId?: string;
  fileName?: string;
  mimeType?: string;
  dataBase64?: string;
};

type ParsedUploadBody = {
  sessionId: string;
  fileName: string;
  mimeType: string;
  dataBase64: string;
};

function invalidUploadRequestError() {
  return new HttpError(
    400,
    'Invalid session file upload request body',
    'invalid_session_file_upload_request'
  );
}

async function readUploadBody(req: IncomingMessage): Promise<UploadBody> {
  try {
    return await readJsonBody<UploadBody>(req);
  } catch {
    throw invalidUploadRequestError();
  }
}

function parseUploadBody(body: UploadBody): ParsedUploadBody {
  if (
    typeof body.sessionId !== 'string' ||
    typeof body.fileName !== 'string' ||
    typeof body.mimeType !== 'string' ||
    typeof body.dataBase64 !== 'string'
  ) {
    throw invalidUploadRequestError();
  }

  return {
    sessionId: body.sessionId,
    fileName: body.fileName,
    mimeType: body.mimeType,
    dataBase64: body.dataBase64,
  };
}

function decodeBase64OrThrow(dataBase64: string): Uint8Array {
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(dataBase64)
  ) {
    throw new HttpError(
      400,
      'Session file upload dataBase64 is invalid',
      'session_file_upload_data_base64_invalid'
    );
  }

  return Uint8Array.from(Buffer.from(dataBase64, 'base64'));
}

export function createSessionFilesRoute(service: SessionFileService) {
  return async function handleSessionFiles(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL
  ) {
    if (req.method === 'POST' && url.pathname === '/api/session-files/upload') {
      const body = parseUploadBody(await readUploadBody(req));
      const attachment = await service.saveUploadedFile({
        sessionId: body.sessionId,
        fileName: body.fileName,
        mimeType: body.mimeType,
        content: decodeBase64OrThrow(body.dataBase64),
      });
      sendJson(res, 200, { attachment });
      return true;
    }

    const params = matchPath('/api/session-files/:sessionFileId', url.pathname);
    if (params && req.method === 'DELETE') {
      sendJson(
        res,
        200,
        await service.deleteFile({
          sessionId: url.searchParams.get('sessionId') || '',
          sessionFileId: params.sessionFileId,
        })
      );
      return true;
    }

    return false;
  };
}
