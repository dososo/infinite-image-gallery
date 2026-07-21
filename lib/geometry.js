// 纯几何逻辑 —— 无 DOM、无副作用,可被 node --test 直接测试。

// 把 value 回卷到 [0, size) —— 循环取模基础工具
export function wrap(value, size) {
  return ((value % size) + size) % size;
}

// 确定性 PRNG(同 seed 同序列,便于测试与复现)
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 漫游态 scatter —— 环形(周期边界)泊松盘采样(Bridson)。
// 关键:间距用「环形距离」(把画布当首尾相连的循环面)计算,保证画布平铺无限循环后,
// 接缝两侧的图也保持 ≥ minDist,永不重叠。蓝噪声天生均匀(无疏密不均、无行列骨架)。
// 返回撒到的点(≤ n);区域够大时能撒满 n。O(n²) 判距,n≈100 一次性开销可忽略。
export function scatterPositions(n, W, H, minDist, seed = 1) {
  const rand = mulberry32(seed);
  const k = 30;
  const md2 = minDist * minDist;
  const pts = [];
  const active = [];

  // 环形距离平方:每个轴取「直接距离」与「绕边一圈距离」的较小值
  const dist2 = (ax, ay, bx, by) => {
    let dx = Math.abs(ax - bx); if (dx > W - dx) dx = W - dx;
    let dy = Math.abs(ay - by); if (dy > H - dy) dy = H - dy;
    return dx * dx + dy * dy;
  };
  const fits = (x, y) => {
    for (let i = 0; i < pts.length; i++) if (dist2(x, y, pts[i].x, pts[i].y) < md2) return false;
    return true;
  };
  const add = (x, y) => { pts.push({ x, y }); active.push(pts.length - 1); };

  add(rand() * W, rand() * H);
  while (active.length && pts.length < n) {
    const ai = Math.floor(rand() * active.length);
    const p = pts[active[ai]];
    let placed = false;
    for (let t = 0; t < k; t++) {
      const ang = rand() * 2 * Math.PI;
      const r = minDist * (1 + rand());
      const x = ((p.x + r * Math.cos(ang)) % W + W) % W;   // 候选点也环形回卷
      const y = ((p.y + r * Math.sin(ang)) % H + H) % H;
      if (fits(x, y)) { add(x, y); placed = true; break; }
    }
    if (!placed) active.splice(ai, 1);
  }
  return pts;
}

// 收拢/圆盘态 sphere —— 斐波那契球面(黄金角均匀分布),返回 n 个 3D 点(单位球 × R)。
// 投影(近大远小 + 近清远糊景深)交给渲染层。比平面盘立体,是"聚成球"的视觉核心。
export function spherePositions(n, R) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;                 // 1 → -1 均匀分层
    const rr = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = 2.399963 * i;                      // 黄金角(弧度)
    pts.push({ x: Math.cos(theta) * rr * R, y: y * R, z: Math.sin(theta) * rr * R });
  }
  return pts;
}

// 收拢态 ball(备用):斐波那契平面盘,聚到中心 (cx,cy) 半径 R 内。返回 tile 左上角坐标。
export function ballPositions(n, cx, cy, R, tileW, tileH) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const angle = i * 2.399963;
    const r = Math.sqrt(i / n) * R;
    pts.push({ x: cx + r * Math.cos(angle) - tileW / 2, y: cy + r * Math.sin(angle) - tileH / 2 });
  }
  return pts;
}

// 组装 tiles 数据:每张预留三套坐标接口,scatter 现填,disc(圆盘)留给后续。
// Lloyd 松弛(环形):点之间近邻施加斥力,迭代若干次使间距趋于均匀、填平局部空洞,
// 同时保持蓝噪声的自然随机(不退化成网格)。环形边界 → 平铺循环后依旧均匀无缝。
export function relaxToroidal(pts, W, H, minDist, iters = 10) {
  const reach = minDist * 1.7;   // 斥力作用半径
  for (let it = 0; it < iters; it++) {
    const fx = new Array(pts.length).fill(0), fy = new Array(pts.length).fill(0);
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        let dx = pts[i].x - pts[j].x; if (dx > W / 2) dx -= W; else if (dx < -W / 2) dx += W;
        let dy = pts[i].y - pts[j].y; if (dy > H / 2) dy -= H; else if (dy < -H / 2) dy += H;
        const d = Math.hypot(dx, dy) || 0.001;
        if (d < reach) {
          const f = (reach - d) / d * 0.5;   // 越近斥力越强
          fx[i] += dx * f; fy[i] += dy * f;
          fx[j] -= dx * f; fy[j] -= dy * f;
        }
      }
    }
    for (let i = 0; i < pts.length; i++) {
      pts[i].x = ((pts[i].x + fx[i] * 0.12) % W + W) % W;
      pts[i].y = ((pts[i].y + fy[i] * 0.12) % H + H) % H;
    }
  }
  return pts;
}

// 矩形 AABB 分离(环形):把「圆判定管不住的矩形角重叠」硬性推开。
// 判定两图(各含 gap 间距)是否 AABB 相交,相交就沿重叠更小的轴对推,迭代到全部分离。
// 这是矩形不重叠的确定性正解(圆形 minDist 判定做不到)。
export function separateRects(pts, W, H, rw, rh, gap, iters = 60) {
  const needX = rw + gap, needY = rh + gap;
  for (let it = 0; it < iters; it++) {
    let moved = false;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        let dx = pts[i].x - pts[j].x; if (dx > W / 2) dx -= W; else if (dx < -W / 2) dx += W;
        let dy = pts[i].y - pts[j].y; if (dy > H / 2) dy -= H; else if (dy < -H / 2) dy += H;
        const ox = needX - Math.abs(dx), oy = needY - Math.abs(dy);
        if (ox > 0 && oy > 0) {   // 两矩形(含 gap)相交 → 推开
          moved = true;
          if (ox <= oy) {
            const push = (ox / 2 + 0.5) * (dx < 0 ? -1 : 1);
            pts[i].x = ((pts[i].x + push) % W + W) % W;
            pts[j].x = ((pts[j].x - push) % W + W) % W;
          } else {
            const push = (oy / 2 + 0.5) * (dy < 0 ? -1 : 1);
            pts[i].y = ((pts[i].y + push) % H + H) % H;
            pts[j].y = ((pts[j].y - push) % H + H) % H;
          }
        }
      }
    }
    if (!moved) break;   // 无相交即收敛
  }
  return pts;
}

// R2 塑性常数准随机点阵(Martin Roberts):加性递推 (a1·i, a2·i) mod 1。
// 均匀性超过泊松盘(堆积率 59.2% vs 49.4%),外观非网格(局部随机、全局有序),
// 且 mod 1 天然活在环面上 → 平铺无限循环「接缝零处理、天生无缝」。jitter(λ)调散乱度。
// 这是「散乱中透着内在黄金秩序美」的数学答案,业界画廊几乎无人用它落位 = 差异化。
export function r2Scatter(n, W, H, jitter = 0.55, seed = 1) {
  const a1 = 0.7548776662, a2 = 0.5698402910;   // 1/φ₂ 与 1/φ₂²(φ₂=塑性常数,x³=x+1 的正根)
  const rand = mulberry32(seed);
  const damp = jitter * 0.76 * Math.sqrt(Math.PI) / (2 * Math.sqrt(n));   // Roberts 的 λ 抖动幅度
  const pts = [];
  for (let i = 0; i < n; i++) {
    let x = (0.5 + a1 * i) % 1;
    let y = (0.5 + a2 * i) % 1;
    x = ((x + damp * (rand() - 0.5) * 2) % 1 + 1) % 1;   // 确定性抖动(可复现):破过整齐,保留环面性
    y = ((y + damp * (rand() - 0.5) * 2) % 1 + 1) % 1;
    pts.push({ x: x * W, y: y * H });
  }
  return pts;
}

export function makeTiles(n, W, H, minDist, seed = 1, rect = null) {
  // R2 准随机点阵布中心(天然环面无缝 + 均匀超泊松 + 散乱中有黄金秩序),再用矩形硬约束兜底、绝不重叠
  let scatter = r2Scatter(n, W, H, 0.35, seed);   // jitter 更低 → 间隔更均匀一致(0=最齐,1=最乱)
  if (rect) scatter = separateRects(scatter, W, H, rect.w, rect.h, rect.gap);
  return scatter.map((s, i) => ({
    i,
    pos: { scatter: s, disc: null, ball: null },
  }));
}
