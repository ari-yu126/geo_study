import type { GeoPassedItem, PassedCheck } from '../analysisTypes';

export function geoPassedToPassedChecks(items: GeoPassedItem[]): PassedCheck[] {
  return items.map((p) => ({
    id: p.id,
    label: p.label,
    reason: p.reason,
    description: p.description,
  }));
}
