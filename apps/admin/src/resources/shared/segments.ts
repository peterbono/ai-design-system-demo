/** Customer segments from the data generator (`customer.groups`). Labels live in i18n under segments.names. */
export const SEGMENT_IDS = ['compulsive', 'collector', 'ordered_once', 'regular', 'returns', 'reviewer'] as const;
export type SegmentId = (typeof SEGMENT_IDS)[number];

export function customersFilterLink(filter: Record<string, unknown>): string {
  return `/customers?filter=${encodeURIComponent(JSON.stringify(filter))}`;
}
