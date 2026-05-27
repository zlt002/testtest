type LocationLike = Pick<Location, 'origin' | 'protocol'>;

function isOpaqueOrFileLikeOrigin(locationLike: LocationLike): boolean {
  return (
    !locationLike.origin ||
    locationLike.origin === 'null' ||
    locationLike.origin === 'file://' ||
    locationLike.protocol === 'file:'
  );
}

export function getWindowPostMessageTargetOrigin(locationLike: LocationLike): string {
  return isOpaqueOrFileLikeOrigin(locationLike) ? '*' : locationLike.origin;
}

export function isCurrentPageMessageEventOrigin(
  locationLike: LocationLike,
  eventOrigin: string
): boolean {
  if (!isOpaqueOrFileLikeOrigin(locationLike)) {
    return eventOrigin === locationLike.origin;
  }

  return (
    eventOrigin === 'null' ||
    eventOrigin === 'file://' ||
    eventOrigin === '' ||
    eventOrigin === locationLike.origin
  );
}
