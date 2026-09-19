// A saved route belongs to the player. Keep its IDs and order even when a
// current save no longer contains one of the matching zones.
export function resolveRouteStops(route, zones) {
  const zonesById = new Map(zones.map(zone => [zone.id, zone]));
  return route.map((id, index) => ({id, number: index + 1, zone: zonesById.get(id) ?? null}));
}

// These are saved zone activity hours in the game, never arrival estimates.
export function formatZoneHours(start, end) {
  if (![start, end].every(value => Number.isFinite(value) && value >= 0 && value <= 24)) return 'Hours unavailable';
  const hour = value => {
    const minutes = Math.round(value * 60);
    return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
  };
  return `${hour(start)}–${hour(end)}${end < start ? ' (overnight)' : ''}`;
}

export function routePlan(route, zones) {
  const stops = resolveRouteStops(route, zones).map(stop => ({
    ...stop,
    valid: Number.isFinite(stop.zone?.x) && Number.isFinite(stop.zone?.z),
  }));
  const legs = [];
  let knownDistanceMeters = 0;
  for (let index = 1; index < stops.length; index++) {
    const from = stops[index - 1], to = stops[index];
    if (!from.valid || !to.valid) continue;
    const distanceMeters = Math.hypot(to.zone.x - from.zone.x, to.zone.z - from.zone.z);
    if (!Number.isFinite(distanceMeters)) continue;
    legs.push({from, to, distanceMeters});
    knownDistanceMeters += distanceMeters;
  }
  return {stops, legs, knownDistanceMeters, missingCount: stops.filter(stop => !stop.valid).length};
}
