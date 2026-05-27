import { createHash } from 'node:crypto';

export const DEV_EXTENSION_MANIFEST_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAoh9ge84FngkywTQwr8FjhcJq4NQHX+bBUX7y106uv+sJRyLt6yfCmi2MPyTWhU8bd3IhxCeFnHrCHaGMPXTEEAoeU1g9HaQPUyUgL1TxFHXz2DDiDNOANKiNhTIf9XodT8n8pk4MM8Ot1Hp6pit1Xvfu0536QV3JRD9XNpmHuYvkBQArP7JZ23FLzdV68zP4ZuFFO7HLyqguDMNzv2+Pab4EZEYFTC3+XyDiqKUbxOV2qjWnZhxdrcBu3HDm3KVhgkdZWGovbbJy+s5AKi04bNLIL5B4AWb8ZsROD4hMbj/xdCFZyzIpoixKT6rv+pZ4FyZjlsbV/SSQBcuVnbIMPQIDAQAB';
export const ONLINE_UPDATE_EXTENSION_MANIFEST_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtjVzlR9cE9zV44l999YtraoKbQ77NfaFgwJmpeABPL2HxUK82pD0DFRSv/7FfZ4nEZRDlgZz1zj1yIF4HLnftCZyf/xYIrwhXDojQfYULE8miIGufKEJf/IUBkpFdFKHgfKgowV0M72wNzqaYd27MdR6DczCR5PQKwi5G2JKUJxx4xc2+KD3GOUjpE8DrhzliD3gYcwEZ8lphtOuCUIx5kI97etKEiixqrwFGRoUbHFLXT14+Fqg7jmSu/HaUVWbl/Dx1VbI1hgVZdnJI//UJY+T0qMLV8hcfHPpwBum0lf1rfP+FQwnqoV2wf4k+6f70dE/Xrlckddpkl0IWDSEdwIDAQAB';

export function chromeExtensionIdFromManifestKey(manifestKey: string): string {
  const publicKeyDer = Buffer.from(manifestKey, 'base64');
  const digest = createHash('sha256').update(publicKeyDer).digest();

  return Array.from(digest.subarray(0, 16), (byte) =>
    byte
      .toString(16)
      .padStart(2, '0')
      .replace(/[0-9a-f]/g, (char) => String.fromCharCode('a'.charCodeAt(0) + Number.parseInt(char, 16)))
  ).join('');
}

export const ONLINE_UPDATE_EXTENSION_ID = chromeExtensionIdFromManifestKey(
  ONLINE_UPDATE_EXTENSION_MANIFEST_KEY
);
export const STABLE_DEV_EXTENSION_ID = chromeExtensionIdFromManifestKey(DEV_EXTENSION_MANIFEST_KEY);

export function resolveDevExtensionId(explicitId?: string | null): string {
  const trimmedId = explicitId?.trim();
  if (trimmedId) {
    return trimmedId;
  }

  return STABLE_DEV_EXTENSION_ID;
}

export function buildAllowedOrigins(): string[] {
  return [
    `chrome-extension://${ONLINE_UPDATE_EXTENSION_ID}/`,
    `chrome-extension://${STABLE_DEV_EXTENSION_ID}/`,
  ];
}
