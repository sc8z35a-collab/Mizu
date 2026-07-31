import assert from 'node:assert/strict';
import { calculateRenderScale, RESOLUTION_PROFILES } from '../src/visuals/visual-engine.js';

assert.equal(RESOLUTION_PROFILES.ultra.supersampling, 2);
assert.equal(RESOLUTION_PROFILES.ultra.maxScale, 4);
assert.equal(RESOLUTION_PROFILES.ultra.maxPixels, 18_000_000);
assert.equal(RESOLUTION_PROFILES.cinema.maxPixels, 30_000_000);

const fullHd = calculateRenderScale({ cssWidth: 1920, cssHeight: 1080, devicePixelRatio: 1, mode: 'ultra' });
assert.equal(fullHd.scale, 2);
assert.equal(fullHd.pixelWidth, 3840);
assert.equal(fullHd.pixelHeight, 2160);
assert.equal(fullHd.limited, false);

const phone = calculateRenderScale({ cssWidth: 412, cssHeight: 915, devicePixelRatio: 3, mode: 'ultra' });
assert.equal(phone.scale, 4);
assert.equal(phone.pixelWidth, 1648);
assert.equal(phone.pixelHeight, 3660);

const fourK = calculateRenderScale({ cssWidth: 3840, cssHeight: 2160, devicePixelRatio: 1, mode: 'ultra' });
assert.ok(fourK.limited);
assert.ok(fourK.pixelWidth * fourK.pixelHeight <= 18_020_000);
assert.ok(fourK.scale > 1.45 && fourK.scale < 1.49);

const auto = calculateRenderScale({ cssWidth: 1920, cssHeight: 1080, devicePixelRatio: 1, mode: 'auto' });
assert.equal(auto.scale, 1);
assert.equal(auto.pixelWidth, 1920);
assert.equal(auto.pixelHeight, 1080);

console.log('resolution profile smoke test: OK');

const cinema = calculateRenderScale({ cssWidth: 1920, cssHeight: 1080, devicePixelRatio: 1, mode: 'cinema' });
assert.ok(cinema.scale > 2.3 && cinema.scale < 2.36);
assert.ok(cinema.pixelWidth * cinema.pixelHeight <= 30_100_000);
