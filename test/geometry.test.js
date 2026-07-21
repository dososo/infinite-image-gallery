import test from 'node:test';
import assert from 'node:assert/strict';
import { wrap, scatterPositions, makeTiles, spherePositions, ballPositions, separateRects, r2Scatter } from '../lib/geometry.js';

test('wrap 把值回卷到 [0, size)', () => {
  assert.equal(wrap(0, 100), 0);
  assert.equal(wrap(150, 100), 50);
  assert.equal(wrap(-10, 100), 90);
  assert.equal(wrap(100, 100), 0);
  assert.equal(wrap(-100, 100), 0);
});

test('scatterPositions 环形泊松:n 个点两两环形间距 ≥ minDist(平铺循环不重叠)且在界内', () => {
  const minDist = 150, W = 2500, H = 2000;
  const pts = scatterPositions(48, W, H, minDist);
  assert.equal(pts.length, 48);
  // 环形距离:平铺循环后接缝两侧也必须满足间距
  const torusDist = (a, b) => {
    let dx = Math.abs(a.x - b.x); if (dx > W - dx) dx = W - dx;
    let dy = Math.abs(a.y - b.y); if (dy > H - dy) dy = H - dy;
    return Math.hypot(dx, dy);
  };
  for (let i = 0; i < pts.length; i++) {
    assert.ok(pts[i].x >= 0 && pts[i].x <= W && pts[i].y >= 0 && pts[i].y <= H, 'in bounds');
    for (let j = i + 1; j < pts.length; j++) {
      const d = torusDist(pts[i], pts[j]);
      assert.ok(d >= minDist - 1e-6, `#${i},#${j} 环形间距 ${d.toFixed(1)} < ${minDist}`);
    }
  }
});

test('scatterPositions 同 seed 可复现', () => {
  const a = scatterPositions(20, 2000, 2000, 150, 7);
  const b = scatterPositions(20, 2000, 2000, 150, 7);
  assert.deepEqual(a, b);
});

test('makeTiles 每张预留 scatter/disc/ball 接口', () => {
  const tiles = makeTiles(48, 2500, 2000, 150);
  assert.equal(tiles.length, 48);
  tiles.forEach((t, i) => {
    assert.equal(t.i, i);
    assert.ok(t.pos.scatter && typeof t.pos.scatter.x === 'number');
    assert.equal(t.pos.disc, null);
    assert.equal(t.pos.ball, null);
  });
});

test('spherePositions 返回 n 个落在半径 R 球面上的 3D 点', () => {
  const R = 300;
  const pts = spherePositions(48, R);
  assert.equal(pts.length, 48);
  for (const p of pts) {
    const d = Math.hypot(p.x, p.y, p.z);
    assert.ok(Math.abs(d - R) < 1, `不在球面: ${d.toFixed(2)} vs ${R}`);
  }
});

test('ballPositions 把 n 张聚到中心半径内成球', () => {
  const cx = 700, cy = 500, R = 130, tw = 240, th = 160;
  const pts = ballPositions(48, cx, cy, R, tw, th);
  assert.equal(pts.length, 48);
  for (const p of pts) {
    const dx = p.x + tw / 2 - cx, dy = p.y + th / 2 - cy;
    assert.ok(Math.hypot(dx, dy) <= R + 1e-6, `超出球半径: ${Math.hypot(dx, dy)}`);
  }
});

test('separateRects 环形:矩形硬约束后,任意两图(含 gap)AABB 都不再相交', () => {
  const W = 4000, H = 3000, rw = 264, rh = 176, gap = 26;
  const pts = scatterPositions(80, W, H, 200);   // 故意较密的撒点(会有矩形边角相交)
  const sep = separateRects(pts.map((p) => ({ ...p })), W, H, rw, rh, gap);
  assert.equal(sep.length, pts.length);
  const needX = rw + gap, needY = rh + gap;
  let overlaps = 0;
  for (let i = 0; i < sep.length; i++) {
    for (let j = i + 1; j < sep.length; j++) {
      let dx = Math.abs(sep[i].x - sep[j].x); if (dx > W - dx) dx = W - dx;
      let dy = Math.abs(sep[i].y - sep[j].y); if (dy > H - dy) dy = H - dy;
      if (needX - dx > 0.5 && needY - dy > 0.5) overlaps++;
    }
  }
  assert.equal(overlaps, 0, `仍有 ${overlaps} 对矩形重叠`);
});

test('r2Scatter 塑性常数准随机:n 个点在界内,且 4×4 分格均匀(每格点数极差小)', () => {
  const W = 4000, H = 3000, N = 100;
  const pts = r2Scatter(N, W, H, 0.55, 1);
  assert.equal(pts.length, N);
  for (const p of pts) assert.ok(p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H, 'in bounds');
  const gc = new Array(16).fill(0);
  for (const p of pts) { const gx = Math.min(3, Math.floor(p.x / W * 4)), gy = Math.min(3, Math.floor(p.y / H * 4)); gc[gy * 4 + gx]++; }
  assert.ok(Math.max(...gc) - Math.min(...gc) <= 4, `均匀性差:每格 ${Math.min(...gc)}~${Math.max(...gc)}`);
});
