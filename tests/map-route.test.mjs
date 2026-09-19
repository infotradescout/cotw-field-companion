import test from 'node:test';
import assert from 'node:assert/strict';
import {FieldMap} from '../public/map.js';

// Stub only SVG nodes and terrain/pressure rendering. The real update, draw,
// layer, selection and fitRoute methods execute against the saved route data.
function node(tag = 'g') {
  return {
    tag, attributes: new Map(), children: [], listeners: new Map(), classes: new Set(), text: '',
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    getAttribute(name) { return this.attributes.get(name) ?? null; },
    append(...children) { for (const child of children) child.parent = this; this.children.push(...children); },
    replaceChildren(...children) { this.children = []; this.append(...children); },
    addEventListener(type, callback) { this.listeners.set(type, callback); },
    set textContent(value) { this.text = String(value); },
    get textContent() { return this.text + this.children.map(child => child.textContent).join(' '); },
    getComputedTextLength() { return this.textContent.length * Number(this.getAttribute('font-size')) * .6; },
    get dataset() { return Object.fromEntries([...this.attributes].filter(([name]) => name.startsWith('data-')).map(([name, value]) => [name.slice(5), value])); },
    closest(selector) { return this.attributes.has(selector.slice(1, -1)) ? this : this.parent?.closest(selector) ?? null; },
    get classList() { return {toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name)}; },
    querySelectorAll(selector) { return descendants(this).filter(child => child.attributes.has(selector.slice(1, -1))); },
  };
}
function descendants(parent) { return parent.children.flatMap(child => [child, ...descendants(child)]); }
function harness(t, size = {width: 500, height: 500}) {
  const originalDocument = globalThis.document;
  globalThis.document = {createElementNS: (_namespace, tag) => node(tag)};
  t.after(() => { if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument; });
  const svg = node('svg'), overlay = node(), selected = [], terrainCalls = [], pressureCalls = [];
  svg.getBoundingClientRect = () => size;
  svg.append(overlay);
  const map = Object.assign(Object.create(FieldMap.prototype), {
    svg, overlay, background: node('rect'), box: [0, 0, 1000, 1000], reserve: 19,
    point: null, poiFilter: 'all',
    layers: {route: true, zones: true, equipment: true, poi: true, grid: false, pressure: true},
    terrain: {update: (...args) => terrainCalls.push(args)},
    pressure: {update: (...args) => pressureCalls.push(args)},
    onSelect: id => selected.push(id), onPoint() {},
  });
  const reserve = {id: 19, bounds: [[0, 0], [1000, 1000]], poi: []};
  const update = data => map.update({reserve, terrain: true, ...data});
  const nodes = attribute => descendants(overlay).filter(child => child.attributes.has(attribute));
  return {map, update, nodes, selected, terrainCalls, pressureCalls};
}
const zone = (id, x, z, extra = {}) => ({id, x, z, species: 'Moose', need: 'drinking', start: 6, end: 10, ...extra});

test('route markers and directed legs survive an empty species-filtered zone list', t => {
  const h = harness(t), full = [zone('a', 100, 100), zone('b', 700, 700)];
  h.update({zones: [], routeZones: full, route: ['a', 'b'], selectedZone: 'b'});
  assert.deepEqual(h.nodes('data-route-stop').map(item => [item.getAttribute('data-route-stop'), item.getAttribute('data-zone')]), [['1', 'a'], ['2', 'b']]);
  assert.deepEqual(h.nodes('data-route-leg').map(item => item.getAttribute('data-route-leg')), ['1-2']);
  const arrow = h.nodes('data-route-direction')[0];
  assert.ok(arrow, 'each nonzero leg has a visible forward arrow');
  const positions = arrow.getAttribute('d').match(/-?\d+(?:\.\d+)?/g).map(Number);
  assert.ok(positions[2] > positions[0] && positions[3] > positions[1], 'the arrow tip points from stop1 toward stop2');
  assert.ok(h.nodes('data-route-stop')[1].classes.has('active-zone'), 'selection remains visible on its numbered marker');
  assert.equal(h.terrainCalls.length, 1);
  assert.deepEqual(h.pressureCalls, [[null, true]]);
  h.map.layers.zones = false;
  h.map.draw();
  assert.equal(h.nodes('data-route-stop').length, 2, 'the route layer is independent of the zones layer');
});

test('drawing never adds a shortcut across a missing or invalid middle route stop', t => {
  const h = harness(t), full = [zone('a', 100, 100), zone('b', 500, 500), zone('c', 800, 800), zone('bad', NaN, 300)];
  h.update({zones: full, routeZones: full, route: ['a', 'missing', 'b', 'c', 'bad', 'a']});
  assert.deepEqual(h.nodes('data-route-stop').map(item => item.getAttribute('data-route-stop')), ['1', '3', '4', '6']);
  assert.deepEqual(h.nodes('data-route-leg').map(item => item.getAttribute('data-route-leg')), ['3-4']);
  assert.equal(h.nodes('data-route-direction').length, 1);
  assert.equal(h.nodes('data-route-leg')[0].getAttribute('pointer-events'), 'none', 'route lines cannot intercept map gestures');
});

test('route marker labels expose names and validated in-game hours and remain selectable', t => {
  const h = harness(t), full = [
    zone('night', 100, 200, {start: 20, end: 2, annotation: {name: 'North lake'}}),
    zone('unknown', 700, 600, {start: null, end: undefined}),
  ];
  h.update({routeZones: full, route: ['night', 'unknown']});
  const markers = h.nodes('data-route-stop');
  assert.match(markers[0].getAttribute('aria-label'), /Route stop 1, North lake/);
  assert.match(markers[0].textContent, /20:00–02:00 \(overnight\) in-game/);
  assert.match(markers[1].textContent, /Hours unavailable/);
  assert.doesNotMatch(markers[1].textContent, /00:00/);
  let prevented = false;
  markers[0].listeners.get('keydown')({key: 'Enter', preventDefault() { prevented = true; }});
  assert.equal(prevented, true);
  assert.deepEqual(h.selected, ['night']);
});

test('turning the route layer off removes route marks without changing route IDs', t => {
  const h = harness(t), route = Object.freeze(['a', 'b']), full = [zone('a', 100, 100), zone('b', 700, 700)];
  h.update({zones: full, routeZones: full, route});
  h.map.setLayer('route', false);
  assert.deepEqual(h.nodes('data-route-stop'), []);
  assert.deepEqual(h.nodes('data-route-leg'), []);
  assert.equal(h.map.data.route, route);
  assert.ok(h.nodes('data-zone').some(item => item.getAttribute('data-zone') === 'a'), 'normal zone markers are restored');
  h.map.setLayer('route', true);
  assert.equal(h.nodes('data-route-stop').length, 2);
});

test('fitRoute contains only valid saved route stops and preserves selection and map point', t => {
  const h = harness(t, {width: 390, height: 844}), point = [52, 84];
  const full = [zone('a', -2000, -4000), zone('b', 4500, 7500), zone('unrelated', 50000, 50000), zone('bad', Infinity, 0)];
  h.update({zones: [], routeZones: full, route: ['a', 'missing', 'bad', 'b'], selectedZone: 'a'});
  h.map.point = point;
  h.map.layers.route = false;
  assert.equal(h.map.fitRoute(), true);
  assert.equal(h.map.layers.route, true);
  const [x, z, width, height] = h.map.box;
  assert.ok(h.map.box.every(Number.isFinite));
  for (const stop of full.slice(0, 2)) assert.ok(stop.x >= x && stop.x <= x + width && stop.z >= z && stop.z <= z + height);
  assert.ok(x + width < 50000 && z + height < 50000, 'unrelated full-source zones do not widen the route framing');
  assert.equal(h.map.data.selectedZone, 'a');
  assert.equal(h.map.point, point);
  const before = [...h.map.box];
  h.map.data.route = ['missing', 'bad'];
  assert.equal(h.map.fitRoute(), false);
  assert.deepEqual(h.map.box, before, 'an unplottable route does not reset the current pan/zoom');
});

test('saved names are drawn on ordinary zones and equipment pins', t => {
  const h = harness(t);
  h.update({zones: [zone('a', 100, 100, {annotation: {name: 'South meadow'}})], pins: [{id: 'pin', x: 700, z: 700, label: 'Tent by the river', kind: 'tent'}]});
  const text = h.map.overlay.textContent;
  assert.match(text, /South meadow/);
  assert.match(text, /Tent by the river/);
  const pin = h.nodes('data-pin').find(item => item.tag === 'g');
  const diamond = pin.children.find(item => item.tag === 'path');
  assert.match(diamond.getAttribute('d'), /l-16,16l-16,-16Z$/, 'the existing equipment marker geometry is preserved');
});

test('phone route labels switch left, stay within the viewport and retain full schedules', t => {
  const h = harness(t, {width: 390, height: 844}), longName = 'North lake beyond the old lookout with the unusually long saved name';
  h.update({routeZones: [zone('a', 12800, 7832, {annotation: {name: 'North lake'}}), zone('b', 13100, 8380, {annotation: {name: longName}, start: 20, end: 2}), zone('c', 12100, 8520)], route: ['a', 'b', 'c']});
  h.map.fitRoute();
  const names = h.nodes('data-route-name'), name = names[1], marker = h.nodes('data-route-stop')[1];
  assert.equal(name.getAttribute('text-anchor'), 'end', 'the rightmost label uses the space to its left');
  assert.equal(names[0].textContent, 'North lake', 'ordinary saved names remain complete');
  assert.ok(name.textContent.endsWith('…'), 'only an overlong alias is shortened visually');
  assert.ok(marker.getAttribute('aria-label').includes(longName), 'the complete alias remains accessible');
  assert.deepEqual([marker.getAttribute('data-world-x'), marker.getAttribute('data-world-z')], ['13100', '8380']);
  const [left, , width] = h.map.box;
  for (const text of names) {
    const x = Number(text.getAttribute('x')), measured = text.getComputedTextLength(), end = text.getAttribute('text-anchor') === 'end';
    assert.ok((end ? x - measured : x) >= left && (end ? x : x + measured) <= left + width, 'the measured name fits inside the map');
  }
  const hours = h.nodes('data-route-hours')[1];
  assert.equal(hours.children.map(line => line.textContent).join(' '), 'drinking · 20:00–02:00 (overnight)', 'wrapped hours lose no schedule information');
  for (const line of hours.children) {
    const x = Number(line.getAttribute('x')), measured = line.textContent.length * Number(hours.getAttribute('font-size')) * .6;
    assert.ok(x - measured >= left && x <= left + width, 'each schedule line fits inside the map');
  }
});

test('route label, number and padded label area select the route zone through pointer gestures', t => {
  const h = harness(t), full = [zone('a', 100, 100), zone('b', 800, 800)];
  h.update({routeZones: full, route: ['a', 'b']});
  Object.assign(h.map, {abort: new AbortController(), pointers: new Map(), pinch: null, toWorld: e => [e.clientX, e.clientY]});
  h.map.svg.setPointerCapture = () => {};
  h.map.svg.hasPointerCapture = () => false;
  h.map.setEvents();
  const marker = h.nodes('data-route-stop')[0], name = h.nodes('data-route-name')[0], number = marker.children.find(child => child.tag === 'text'), hit = h.nodes('data-route-hit')[0];
  for (const text of [name, number, h.nodes('data-route-hours')[0]]) assert.equal(text.getAttribute('style'), 'pointer-events:all', 'inline pointer behavior overrides the shared noninteractive map-text CSS');
  assert.ok(Number(hit.getAttribute('width')) >= 88 && Number(hit.getAttribute('height')) >= 88, 'the hit rectangle covers at least 44 screen pixels at the current scale');
  const hitLayer = h.nodes('data-map-hit-layer')[0];
  assert.ok(h.map.overlay.children.indexOf(hitLayer) < h.map.overlay.children.indexOf(marker), 'padded hit targets cannot cover another visible marker');
  for (const target of [name, number, hit]) {
    const event = {target, button: 0, pointerId: 1, clientX: 150, clientY: 100};
    h.map.svg.listeners.get('pointerdown')(event);
    h.map.svg.listeners.get('pointerup')(event);
  }
  assert.deepEqual(h.selected, ['a', 'a', 'a']);
  assert.equal(h.map.point, null, 'route label taps do not create a map point');
});

test('route species labels use Great One gold while saved aliases stay neutral', t => {
  const h = harness(t);
  h.update({routeZones: [zone('a', 100, 100), zone('b', 700, 700, {annotation: {name: 'North lake'}})], route: ['a', 'b']});
  assert.deepEqual(h.nodes('data-route-name').map(item => item.getAttribute('fill')), ['#f0c76d', '#fff4db']);
});
