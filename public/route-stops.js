// A saved route belongs to the player. Keep its IDs and order even when a
// current save no longer contains one of the matching zones.
export function resolveRouteStops(route, zones) {
  const zonesById = new Map(zones.map(zone => [zone.id, zone]));
  return route.map((id, index) => ({id, number: index + 1, zone: zonesById.get(id) ?? null}));
}
