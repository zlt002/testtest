import { isLivePageMode, isLocalSnapshotMode } from '../../../runtime/page-mode.js';

export function createSelectionPresentationPolicy({
  pageMode,
  activeTool,
  showSelectionActionsEverywhere,
}) {
  if (isLivePageMode(pageMode)) {
    return {
      kind: 'live-page',
      showHoverLabel: false,
      showSelectionLabel: true,
      showSelectionMetadata: false,
      showMeasurement: false,
      showGridlines: false,
      showHandles: false,
      showSelectedOutline: true,
      showActionBar: true,
    };
  }

  if (isLocalSnapshotMode(pageMode)) {
    const showSelectionMetadata = activeTool === 'inspector' || activeTool === 'accessibility';
    const showSelectionLabel =
      showSelectionMetadata || showSelectionActionsEverywhere === true;

    return {
      kind: 'local-snapshot',
      showHoverLabel: activeTool === 'guides',
      showSelectionLabel,
      showSelectionMetadata,
      showMeasurement: activeTool === 'guides',
      showGridlines: activeTool === 'guides',
      showHandles: true,
      showSelectedOutline: false,
      showActionBar: true,
    };
  }

  return {
    kind: 'fallback',
    showHoverLabel: false,
    showSelectionLabel: false,
    showSelectionMetadata: false,
    showMeasurement: false,
    showGridlines: false,
    showHandles: false,
    showSelectedOutline: false,
    showActionBar: false,
  };
}
