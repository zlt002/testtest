export type ScrollMetrics = {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
};

export function hasScrollableContentBelow(metrics: ScrollMetrics, threshold = 24) {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight > threshold;
}
