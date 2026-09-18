import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {FieldMap,HuntingPressureLayer} from '../public/map.js';

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

function pressurePacket(values=new Uint8Array(65536),overrides={}) {
  return {status:'available',reserve:19,width:256,height:256,values,
    bounds:[[250,-300],[850,900]],sourceHash:createHash('sha256').update(values).digest('hex'),
    savedAt:'2026-09-18T12:00:00Z',stale:false,...overrides};
}
function pressureHarness() {
  const attributes=new Map(),images=[];
  let canvases=0;
  const node={setAttribute:(name,value)=>attributes.set(name,String(value)),
    getAttribute:name=>attributes.get(name),removeAttribute:name=>attributes.delete(name),remove(){}};
  const layer=new HuntingPressureLayer(node,()=>{
    canvases++;
    return {getContext:()=>({
      createImageData:(width,height)=>({data:new Uint8ClampedArray(width*height*4)}),
      putImageData:image=>images.push(image.data),
    }),toDataURL:()=>`data:image/png;base64,synthetic-${canvases}`};
  });
  return {layer,attributes,images,canvasCount:()=>canvases};
}

test('saved pressure raster keeps each corner and cell in its original X/Z position',()=>{
  const h=pressureHarness(),values=new Uint8Array(65536);
  values[0]=32;values[255]=96;values[255*256]=160;values[65535]=255;values[7*256+3]=200;
  const result=h.layer.update(pressurePacket(values));
  assert.equal(result.status,'available');assert.equal(result.hasPressure,true);
  assert.equal(h.attributes.get('x'),'250');assert.equal(h.attributes.get('y'),'-300');
  assert.equal(h.attributes.get('width'),'600');assert.equal(h.attributes.get('height'),'1200');
  assert.equal(h.attributes.get('preserveAspectRatio'),'none');
  assert.equal(h.attributes.has('transform'),false,'no axis flip or transpose');
  const pixels=h.images[0],alpha=index=>pixels[index*4+3];
  assert.ok(alpha(0)>0&&alpha(0)<alpha(255)&&alpha(255)<alpha(255*256)&&alpha(255*256)<alpha(65535),'saved intensities stay in their four distinct corners');
  assert.ok(alpha(7*256+3)>0,'the saved row/column cell is visible');
  assert.equal(alpha(3*256+7),0,'rows and columns are not swapped');
  assert.equal(alpha(7*256+2),0,'no guessed radius spreads pressure into another cell');
  assert.ok(pixels[0]>pixels[1]&&pixels[2]>pixels[1],'pressure uses purple/magenta');
  assert.equal(h.attributes.get('pointer-events'),'none','pressure cannot block marker taps');
});

test('an all-zero pressure save is valid and draws no invented pressure',()=>{
  const h=pressureHarness(),state=h.layer.update(pressurePacket());
  assert.equal(state.status,'available');assert.equal(state.hasPressure,false);
  assert.equal(h.attributes.get('visibility'),'hidden');assert.equal(h.attributes.has('href'),false);
  assert.equal(h.canvasCount(),0,'an empty grid needs no raster image');
});

test('unchanged pressure across polling, filtering, and toggles reuses one raster',()=>{
  const h=pressureHarness(),values=new Uint8Array(65536);values[1234]=220;
  const packet=pressurePacket(values);h.layer.update(packet);
  const originalImage=h.attributes.get('href');
  const later={...packet,values:Array.from(values),savedAt:'2026-09-18T12:05:00Z',stale:true};
  h.layer.update(later,false);
  assert.equal(h.attributes.get('visibility'),'hidden');
  const state=h.layer.update({...later},true);
  assert.equal(state.stale,true);assert.equal(state.savedAt,later.savedAt);
  assert.equal(h.attributes.get('visibility'),'visible');assert.equal(h.attributes.get('href'),originalImage);
  assert.equal(h.canvasCount(),1);assert.equal(h.images.length,1);
});

test('missing or invalid pressure clears the previous overlay rather than reusing it',()=>{
  const positive=pressurePacket(new Uint8Array(65536).fill(80));
  const invalidValues=new Uint8Array(65536).fill(40);
  const badBytes=Array.from(invalidValues);badBytes[50]=256;
  const invalid=[null,{status:'unavailable',reserve:19},{...positive,values:[]},
    {...positive,width:128},{...positive,bounds:[[0,0],[0,100]]},
    {...pressurePacket(invalidValues),values:badBytes}];
  for(const packet of invalid){
    const h=pressureHarness();h.layer.update(positive);
    assert.equal(h.layer.update(packet).status,'unavailable');
    assert.equal(h.attributes.get('visibility'),'hidden');assert.equal(h.attributes.has('href'),false);
  }
});

test('pressure raster memory is bounded as newer saves arrive',()=>{
  const h=pressureHarness();
  for(let i=1;i<=12;i++)h.layer.update(pressurePacket(new Uint8Array(65536).fill(i)));
  assert.ok(h.layer.cache.size<=2,'only a bounded number of recent rasters remains');
  h.layer.destroy();assert.equal(h.layer.cache.size,0);assert.equal(h.attributes.has('href'),false);
});

test('a pressure map from another reserve is never attached to the current hunt',()=>{
  const map=Object.assign(Object.create(FieldMap.prototype),{reserve:19,draw(){},home(){}});
  map.update({reserve:{id:19},huntingPressure:pressurePacket(undefined,{reserve:18})});
  assert.equal(map.data.huntingPressure,null);
  const own=pressurePacket();map.update({reserve:{id:19},huntingPressure:own});
  assert.equal(map.data.huntingPressure,own);
});

test('the pressure image sits above terrain and below interactive markers',t=>{
  const previous=globalThis.document;
  const node=()=>({children:[],setAttribute(){},append(...children){this.children.push(...children);},
    replaceChildren(...children){this.children=children;},addEventListener(){},style:{}});
  globalThis.document={createElementNS:()=>node()};
  t.after(()=>{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;});
  const svg=node(),map=new FieldMap(svg);
  assert.ok(svg.children.indexOf(map.terrain.node)<svg.children.indexOf(map.pressure.node));
  assert.ok(svg.children.indexOf(map.pressure.node)<svg.children.indexOf(map.overlay));
  map.abort.abort();
});
