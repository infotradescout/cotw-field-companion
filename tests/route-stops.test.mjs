import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveRouteStops} from '../public/route-stops.js';

test('a saved route with no matching zones still has visible, removable stop identities', () => {
  const route = Object.freeze(['old-zone:19:123']);
  assert.deepEqual(resolveRouteStops(route, []), [
    {id: 'old-zone:19:123', number: 1, zone: null},
  ]);
});

test('missing stops keep their original position among known stops', () => {
  const first = Object.freeze({id: 'first', species: 'Moose'});
  const last = Object.freeze({id: 'last', species: 'Red Deer'});
  const route = Object.freeze(['first', 'missing', 'last']);
  const zones = Object.freeze([last, first]);
  const stops = resolveRouteStops(route, zones);
  assert.equal(stops.length, route.length, 'the displayed count includes every saved stop');
  assert.deepEqual(stops.map(stop => [stop.id, stop.number]), [['first', 1], ['missing', 2], ['last', 3]]);
  assert.equal(stops[0].zone, first);
  assert.equal(stops[1].zone, null);
  assert.equal(stops[2].zone, last);
  assert.deepEqual(route, ['first', 'missing', 'last'], 'resolving a route does not change saved IDs');
  assert.deepEqual(zones, [last, first], 'resolving a route does not reorder zones');
});

test('a similar ID or matching display name never substitutes for a missing zone', () => {
  const zones = [
    {id: 'ZONE-1', annotation: {name: 'zone-1'}},
    {id: ' zone-1 ', species: 'zone-1'},
  ];
  assert.deepEqual(resolveRouteStops(['zone-1'], zones), [{id: 'zone-1', number: 1, zone: null}]);
});

test('opaque and repeated saved IDs are preserved without normalization or silent removal', () => {
  const route = ['zone:<old>&"', 'missing', 'missing'];
  const stops = resolveRouteStops(route, []);
  assert.deepEqual(stops.map(stop => stop.id), route);
  assert.deepEqual(stops.map(stop => stop.number), [1, 2, 3]);
  assert.ok(stops.every(stop => stop.zone === null));
});

test('only an empty saved route resolves to an empty list', () => {
  assert.deepEqual(resolveRouteStops([], [{id: 'available'}]), []);
  assert.equal(resolveRouteStops(['missing'], []).length, 1);
});
