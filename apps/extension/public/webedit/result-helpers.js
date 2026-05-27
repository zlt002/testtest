(function (global) {
  'use strict';

  if (global.__webeditResultHelpers) {
    return;
  }

  function pickDefined(input) {
    const source = input && typeof input === 'object' ? input : {};
    const output = {};

    Object.keys(source).forEach(function (key) {
      if (typeof source[key] !== 'undefined') {
        output[key] = source[key];
      }
    });

    return output;
  }

  function safeString(value) {
    if (value === null || typeof value === 'undefined') {
      return null;
    }

    try {
      return String(value);
    } catch (error) {
      return '[unserializable]';
    }
  }

  function normalizeArgs(args) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      return {};
    }
    return args;
  }

  function serializeError(error, fallbackCode) {
    const source = error || {};
    return pickDefined({
      code: source.code || fallbackCode || 'UNKNOWN_ERROR',
      message: source.message || safeString(source) || 'Unknown error',
      details: source.details,
      cause: source.cause,
      stack: source.stack,
    });
  }

  function toTextPayload(payload) {
    try {
      return JSON.stringify(payload, null, 2);
    } catch (error) {
      return JSON.stringify({
        ok: false,
        error: serializeError(error, 'SERIALIZE_ERROR'),
      });
    }
  }

  function toToolResult(payload, options) {
    if (
      payload &&
      typeof payload === 'object' &&
      Array.isArray(payload.content) &&
      payload.content.length > 0
    ) {
      return payload;
    }

    const settings = options && typeof options === 'object' ? options : {};
    const body = typeof payload === 'undefined' ? null : payload;

    return pickDefined({
      content: [
        {
          type: 'text',
          text: toTextPayload(body),
        },
      ],
      isError: settings.isError === true ? true : undefined,
      meta: settings.meta,
    });
  }

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function ok(data, options, legacyData) {
    if (arguments.length >= 3) {
      return toToolResult(
        pickDefined({
          ok: true,
          operation: typeof data === 'string' ? data : null,
          target: isPlainObject(options) ? options : null,
          data: typeof legacyData === 'undefined' ? null : legacyData,
        })
      );
    }

    const settings = options && typeof options === 'object' ? options : {};
    return toToolResult(
      pickDefined({
        ok: true,
        data: typeof data === 'undefined' ? null : data,
        meta: settings.meta,
      }),
      settings
    );
  }

  function fail(error, options, legacyCode, legacyMessage, legacyDetails) {
    if (arguments.length >= 4) {
      return toToolResult(
        pickDefined({
          ok: false,
          operation: typeof error === 'string' ? error : null,
          target: isPlainObject(options) ? options : null,
          error: pickDefined({
            code: legacyCode || 'UNKNOWN_ERROR',
            message: legacyMessage || 'Unknown error',
            details: legacyDetails,
          }),
        }),
        { isError: true }
      );
    }

    const settings = options && typeof options === 'object' ? options : {};
    return toToolResult(
      pickDefined({
        ok: false,
        error: serializeError(error, settings.code),
        meta: settings.meta,
      }),
      pickDefined({
        isError: true,
        meta: settings.meta,
      })
    );
  }

  global.__webeditResultHelpers = {
    pickDefined: pickDefined,
    safeString: safeString,
    normalizeArgs: normalizeArgs,
    serializeError: serializeError,
    toToolResult: toToolResult,
    ok: ok,
    fail: fail,
  };
})(window);
