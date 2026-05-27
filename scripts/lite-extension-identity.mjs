import { createHash } from 'node:crypto';

export const ONLINE_UPDATE_EXTENSION_MANIFEST_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtjVzlR9cE9zV44l999YtraoKbQ77NfaFgwJmpeABPL2HxUK82pD0DFRSv/7FfZ4nEZRDlgZz1zj1yIF4HLnftCZyf/xYIrwhXDojQfYULE8miIGufKEJf/IUBkpFdFKHgfKgowV0M72wNzqaYd27MdR6DczCR5PQKwi5G2JKUJxx4xc2+KD3GOUjpE8DrhzliD3gYcwEZ8lphtOuCUIx5kI97etKEiixqrwFGRoUbHFLXT14+Fqg7jmSu/HaUVWbl/Dx1VbI1hgVZdnJI//UJY+T0qMLV8hcfHPpwBum0lf1rfP+FQwnqoV2wf4k+6f70dE/Xrlckddpkl0IWDSEdwIDAQAB';

export function chromeExtensionIdFromManifestKey(manifestKey) {
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
