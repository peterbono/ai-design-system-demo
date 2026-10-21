// Words for a guest page read from the team's published activity (scripts/guest-activity.ts). Pure.

/** "Updated just now", "Updated 5 min ago", "Updated 3 h ago", "Updated Oct 21": how recent the published activity is. */
export function updatedLine(iso: string, now = Date.now()): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return 'Updated recently';
  const min = Math.max(0, Math.round((now - at) / 60_000));
  if (min < 1) return 'Updated just now';
  if (min < 60) return `Updated ${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `Updated ${h} h ago`;
  return `Updated ${new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}
