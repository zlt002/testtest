import {
  buildAllowedOrigins,
  chromeExtensionIdFromManifestKey,
  DEV_EXTENSION_MANIFEST_KEY,
  ONLINE_UPDATE_EXTENSION_ID,
  ONLINE_UPDATE_EXTENSION_MANIFEST_KEY,
  resolveDevExtensionId,
} from './dev-extension-identity';

describe('dev extension identity', () => {
  it('derives the stable development extension id from the manifest key', () => {
    expect(chromeExtensionIdFromManifestKey(DEV_EXTENSION_MANIFEST_KEY)).toBe(
      'ipccjlofbkbomhcgobojmmnfbbgidfif'
    );
  });

  it('derives the online-update extension id from the fixed manifest key', () => {
    expect(chromeExtensionIdFromManifestKey(ONLINE_UPDATE_EXTENSION_MANIFEST_KEY)).toBe(
      ONLINE_UPDATE_EXTENSION_ID
    );
    expect(ONLINE_UPDATE_EXTENSION_ID).toBe('cmgjacoohdgjedoekbdbhbelpmboankg');
  });

  it('prefers an explicit development extension id when provided', () => {
    expect(resolveDevExtensionId('jinialjopfmgoeceohaehmkfcjejmdpd')).toBe(
      'jinialjopfmgoeceohaehmkfcjejmdpd'
    );
  });

  it('returns only the online-update and stable development extension ids', () => {
    expect(buildAllowedOrigins()).toEqual([
      `chrome-extension://${ONLINE_UPDATE_EXTENSION_ID}/`,
      'chrome-extension://ipccjlofbkbomhcgobojmmnfbbgidfif/',
    ]);
  });
});
