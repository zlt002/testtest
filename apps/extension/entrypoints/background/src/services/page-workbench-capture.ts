import type { ElementAnnotation, SelectionTarget, AnnotationPageType } from './page-annotations';
import type { PageCaptureArtifact } from './page-capture-types';

export type WorkbenchCaptureAsset = {
  captureId: string;
  entryPath: string;
  artifact: PageCaptureArtifact;
  sourcePageUrl?: string;
  sourcePageType?: AnnotationPageType | null;
  parentCaptureId?: string | null;
  targets?: SelectionTarget[];
  annotations?: ElementAnnotation[];
};

export type SnapshotManifest = {
  captureId: string;
  mode: PageCaptureArtifact['mode'];
  sourcePageUrl: string;
  sourcePageType: AnnotationPageType | null;
  capturedAt: string;
  entryPath: string;
  parentCaptureId: string | null;
  targets: SelectionTarget[];
  annotations: ElementAnnotation[];
};

export function buildSnapshotManifest(asset: WorkbenchCaptureAsset): SnapshotManifest {
  return {
    captureId: asset.captureId,
    mode: asset.artifact.mode,
    sourcePageUrl: asset.sourcePageUrl ?? asset.artifact.url,
    sourcePageType: asset.sourcePageType ?? null,
    capturedAt: asset.artifact.capturedAt,
    entryPath: asset.entryPath,
    parentCaptureId: asset.parentCaptureId ?? null,
    targets: asset.targets ?? [],
    annotations: asset.annotations ?? [],
  };
}
