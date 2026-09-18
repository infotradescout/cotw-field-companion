import test from 'node:test';
import assert from 'node:assert/strict';
import {FieldMap} from '../public/map.js';

const screens = [
  {name: '390px portrait', width: 390, height: 844},
  {name: '844px landscape', width: 844, height: 390},
];
const center = box => [box[0] + box[2] / 2, box[1] + box[3] / 2];
function close(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) <= Math.max(1, Math.abs(expected)) * 1e-10, `${message}: ${actual} versus ${expected}`);
}
function contains(outer, inner) {
  const tolerance = 1e-7;
  assert.ok(outer[0] <= inner[0] + tolerance, 'left boundary remains visible');
  assert.ok(outer[1] <= inner[1] + tolerance, 'top boundary remains visible');
  assert.ok(outer[0] + outer[2] >= inner[0] + inner[2] - tolerance, 'right boundary remains visible');
  assert.ok(outer[1] + outer[3] >= inner[1] + inner[3] - tolerance, 'bottom boundary remains visible');
}
function geometryMap(rect) {
  return Object.assign(Object.create(FieldMap.prototype), {
    svg: {getBoundingClientRect: () => rect},
  });
}

for (const screen of screens) {
  test(`reserve framing contains every edge without moving its center on ${screen.name}`, () => {
    const map = geometryMap(screen);
    for (const input of [[-16384, -8192, 8192, 8192], [100, -6000, 12000, 700], [-500, 700, 600, 18000]]) {
      const before = [...input];
      const result = map.viewportBox(Object.freeze(input), true);
      assert.ok(result.every(Number.isFinite));
      assert.ok(result[2] > 0 && result[3] > 0);
      contains(result, before);
      center(result).forEach((value, index) => close(value, center(before)[index], 'world center'));
      close(result[2] / result[3], screen.width / screen.height, 'screen aspect ratio');
      assert.deepEqual(input, before, 'framing does not mutate reserve bounds');
    }
  });

  test(`reframing a zoomed view preserves horizontal scale and center on ${screen.name}`, () => {
    const input = [-3500, 2400, 1800, 1800];
    const result = geometryMap(screen).viewportBox(input);
    close(result[2], input[2], 'zoom width');
    center(result).forEach((value, index) => close(value, center(input)[index], 'world center'));
    close(result[2] / result[3], screen.width / screen.height, 'screen aspect ratio');
  });
}

test('an unmeasured or hidden SVG leaves usable map coordinates unchanged', () => {
  const input = Object.freeze([-9000, 2000, 2200, 4400]);
  for (const rect of [{width: 0, height: 0}, {width: 0, height: 844}, {width: 390, height: 0}]) {
    for (const contain of [false, true]) {
      const result = geometryMap(rect).viewportBox(input, contain);
      assert.deepEqual(result, input);
      assert.ok(result.every(Number.isFinite));
    }
  }
});

test('rotating a zoomed phone view twice preserves the place and zoom level', () => {
  const rect = {...screens[0]};
  const map = geometryMap(rect);
  const portrait = map.viewportBox([-7800, -3200, 2400, 2400]);
  Object.assign(rect, screens[1]);
  const landscape = map.viewportBox(portrait);
  Object.assign(rect, screens[0]);
  const returned = map.viewportBox(landscape);
  returned.forEach((value, index) => close(value, portrait[index], 'round-trip map bounds'));
});

// Only the browser's SVG event/coordinate boundary is stubbed. The real
// setEvents, toWorld, viewportBox and zoom methods process each gesture.
// This does not prove physical touchscreen or browser pointer delivery.
function gestureMap(screen) {
  const listeners = new Map();
  const captures = new Set();
  const selections = [];
  const points = [];
  const rect = {...screen, left: 12, top: 76};
  const map = Object.create(FieldMap.prototype);
  const svg = {
    addEventListener: (type, callback) => listeners.set(type, callback),
    getBoundingClientRect: () => rect,
    setPointerCapture: id => captures.add(id),
    hasPointerCapture: id => captures.has(id),
    releasePointerCapture: id => captures.delete(id),
    dispatchEvent: () => true,
    getScreenCTM: () => ({inverse: () => ({
      a: map.box[2] / rect.width,
      d: map.box[3] / rect.height,
      e: map.box[0] - rect.left * map.box[2] / rect.width,
      f: map.box[1] - rect.top * map.box[3] / rect.height,
    })}),
    createSVGPoint: () => ({x: 0, y: 0, matrixTransform(matrix) {
      return {x: this.x * matrix.a + matrix.e, y: this.y * matrix.d + matrix.f};
    }}),
  };
  Object.assign(map, {
    svg, abort: new AbortController(), box: [0, 0, 1000, 1000],
    pointers: new Map(), pinch: null, drag: null,
    data: {pins: [], equipment: [], reserve: {poi: []}},
    onSelect: id => selections.push(id), onPoint: point => points.push(point),
    draw() {}, schedule() {},
  });
  map.box = map.viewportBox(map.box);
  map.setEvents();
  const zone = {dataset: {zone: 'synthetic-drink-zone'}};
  const target = {closest: selector => selector === '[data-zone]' ? zone : null};
  const send = (type, pointerId, clientX, clientY) => {
    // Browsers implicitly release this pointer's capture on cancellation.
    if (type === 'pointercancel') captures.delete(pointerId);
    listeners.get(type)({pointerId, clientX, clientY, target, button: 0, pointerType: 'touch', preventDefault() {}});
  };
  const tap = () => {
    send('pointerdown', 9, 120, 150);
    send('pointerup', 9, 120, 150);
  };
  return {map, send, tap, selections, points, captures};
}

for (const screen of screens) {
  for (const releaseOrder of [[1, 2], [2, 1]]) {
    test(`a pinch cannot open a zone when released ${releaseOrder.join(' then ')} on ${screen.name}`, () => {
      const h = gestureMap(screen);
      const originalWidth = h.map.box[2];
      h.send('pointerdown', 1, 100, 150);
      h.send('pointerdown', 2, 180, 150);
      h.send('pointermove', 2, 240, 150);
      assert.ok(h.map.box[2] < originalWidth, 'spreading fingers zooms in');
      for (const id of releaseOrder) h.send('pointerup', id, id === 1 ? 100 : 240, 150);
      assert.deepEqual(h.selections, [], 'lifting either finger does not select a zone');
      assert.deepEqual(h.points, [], 'lifting fingers does not create a map point');
      assert.equal(h.captures.size, 0);
      h.tap();
      assert.deepEqual(h.selections, ['synthetic-drink-zone'], 'a later deliberate tap still works');
    });
  }

  test(`a remaining finger after a pinch cannot turn into a zone tap on ${screen.name}`, () => {
    const h = gestureMap(screen);
    h.send('pointerdown', 1, 100, 150);
    h.send('pointerdown', 2, 180, 150);
    h.send('pointerup', 2, 180, 150);
    h.send('pointermove', 1, 100, 150);
    h.send('pointerup', 1, 100, 150);
    assert.deepEqual(h.selections, []);
    assert.deepEqual(h.points, []);
    h.tap();
    assert.deepEqual(h.selections, ['synthetic-drink-zone']);
  });

  test(`cancelling a pinch cannot select a zone or poison the next tap on ${screen.name}`, () => {
    for (const cancelled of [1, 2]) {
      const h = gestureMap(screen);
      const remaining = cancelled === 1 ? 2 : 1;
      h.send('pointerdown', 1, 100, 150);
      h.send('pointerdown', 2, 180, 150);
      h.send('pointermove', 2, 240, 150);
      h.send('pointercancel', cancelled, cancelled === 1 ? 100 : 240, 150);
      h.send('pointermove', remaining, remaining === 1 ? 100 : 240, 150);
      h.send('pointerup', remaining, remaining === 1 ? 100 : 240, 150);
      assert.deepEqual(h.selections, []);
      assert.deepEqual(h.points, []);
      assert.equal(h.captures.size, 0);
      h.tap();
      assert.deepEqual(h.selections, ['synthetic-drink-zone']);
    }
  });
}
