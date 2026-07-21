import { makeTiles, spherePositions } from './lib/geometry.js?v=9';

const { gsap } = window;

const viewport = document.querySelector('.viewport');
const world = document.querySelector('.world');
const TILE_W = 240, TILE_H = 160;

// 手感参数,支持 URL query 实时调参:?n=100&mind=320&dens=0.6&lerp=0.1
const _q = new URLSearchParams(location.search);
const IMG_COUNT = parseInt(_q.get('n')) || 100;       // 图片总数
const LERP = parseFloat(_q.get('lerp')) || 0.1;       // 松手惯性的相机阻尼(丝滑收敛)
const DRAG_LERP = parseFloat(_q.get('draglerp')) || 0.75; // 拖动中相机跟手速度(越大越贴手、阻尼越小;接近 1=几乎实时跟手)
const FRICTION = parseFloat(_q.get('fric')) || 0.93;  // 松手惯性摩擦衰减(0.93 朝方向持续滚一段再停)
const FLING = parseFloat(_q.get('fling')) || 0.5;     // 惯性速度 = 拖动距离 × 此系数(朝拖动方向,不看松手瞬间速度)
const SPAWN_DUR = parseFloat(_q.get('spawn')) || 2.0; // 涌现总时长(stagger 跨度,先快后慢)
const HOLD = parseFloat(_q.get('hold')) || 0.5;       // 涌现完停留蓄势再散开
const IDLE_DRIFT = parseFloat(_q.get('drift')) || 0.08; // 漫游 idle 漂移速度(更弱,少打转)
const IDLE_SPIN = parseFloat(_q.get('spin')) || 0.004;  // 漂移方向的画圈角速度(整体微微打旋)
const SPOT_R = parseFloat(_q.get('spot')) || 0;         // 追光揭色半径(默认 0=关闭,用 hover 单张变色;?spot=300 开追光)
const MIN_DIST = parseFloat(_q.get('mind')) || 330;   // 散布最小间距(>放大后图对角 317 → 保证不重叠)
const DENSITY = parseFloat(_q.get('dens')) || 0.72;   // 画布填充密度(越大视口内图越多、间隔越小越均匀)

let tiles = [], sphere = [];
let cellW = 0, cellH = 0, vw = 0, vh = 0;
let phase = 'idle';                        // idle(空,等点击) | intro(中心堆叠) | explode(散开) | roam(无限滚动)
let targetX = 0, targetY = 0, camX = 0, camY = 0;
let dragging = false, lastPX = 0, lastPY = 0, downX = 0, downY = 0, velX = 0, velY = 0;
let idleAngle = 0;   // idle 漂移的画圈相位
let zoom = 2.0, ballRot = 0, inBall = false;   // 球 morph:zoom(滚轮值), ballRot(自转角), inBall(当前是否在球态渲染)
const BALL_SPIN = parseFloat(_q.get('bspin')) || 0.0035;   // 球自转速度
let mx = -9999, my = -9999;   // 鼠标位置(追光揭色)
const pointers = new Map();   // 活跃指针:区分单指拖动 / 双指 pinch 缩放
let pinchDist0 = 0, pinchZoom0 = 0;
let hintEl = null, crtEl = null, dotEl = null, tipEl = null;

const clamp = (a, b, v) => Math.max(a, Math.min(b, v));
const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;   // 尊重系统「减少动效」:关装饰动画(漂移/skew/hover 缩放/涌现爆发)

function setPhase(p) { phase = p; if (viewport) viewport.dataset.phase = p; }

// 无限循环:把「已完全拖出视口」的 tile 无缝搬到另一侧(视口外发生,不可见)——上下左右四向
function recycle() {
  for (const t of tiles) {
    let moved = false;
    if (t.wx + camX < -TILE_W) { t.wx += cellW; moved = true; }
    else if (t.wx + camX > vw) { t.wx -= cellW; moved = true; }
    if (t.wy + camY < -TILE_H) { t.wy += cellH; moved = true; }
    else if (t.wy + camY > vh) { t.wy -= cellH; moved = true; }
    if (moved) gsap.set(t.el, { x: t.wx, y: t.wy });
  }
}

// 追光揭色:每张图按「屏幕中心距鼠标的距离」恢复彩色——鼠标像一束光,照到哪片哪片复活
function updateSpotlight() {
  if (SPOT_R <= 0) return;
  for (const t of tiles) {
    const sx = t.wx + camX + TILE_W / 2, sy = t.wy + camY + TILE_H / 2;
    const g = Math.min(1, Math.hypot(sx - mx, sy - my) / SPOT_R);
    const gq = Math.round(g * 12) / 12;   // 量化:只在档位变化时改 filter,省 repaint
    if (t._g !== gq) { t.el.style.filter = `grayscale(${gq})`; t._g = gq; }
  }
}

// 主循环:漫游态每帧「相机 lerp 平滑追 target + 松手惯性 + 无限回收 + 追光揭色」
function raf() {
  if (phase === 'roam') {
    const flat = clamp(0, 1, (zoom - 1.0) / 0.6);   // zoom≥1.6→1(纯平面) / ≤1.0→0(纯球)
    if (flat >= 0.999) {
      // ── 纯平面态:拖动 + 惯性 + 无限循环(完全保留原有手感) ──
      if (inBall) {   // 刚从球态切回平面:重置图到「平面世界坐标」+ 相机归正中(消除球态屏幕坐标残留导致的双倍偏移)
        inBall = false;
        camX = targetX = vw / 2 - cellW / 2;
        camY = targetY = vh / 2 - cellH / 2;
        velX = velY = 0;
        tiles.forEach((t) => gsap.set(t.el, { x: t.wx, y: t.wy, scale: 1.1, opacity: 1, zIndex: '' }));
      }
      if (dragging) {
        camX += (targetX - camX) * DRAG_LERP;
        camY += (targetY - camY) * DRAG_LERP;
      } else {
        camX += velX; camY += velY;
        velX *= FRICTION; velY *= FRICTION;
        if (Math.abs(velX) < 0.03 && Math.abs(velY) < 0.03) {
          velX = velY = 0;
          if (!REDUCE) {   // 减少动效:静止就真静止,不 idle 漂移
            idleAngle += IDLE_SPIN;
            camX += Math.cos(idleAngle) * IDLE_DRIFT;
            camY += Math.sin(idleAngle) * IDLE_DRIFT;
          }
        }
        targetX = camX; targetY = camY;
      }
      viewport.classList.toggle('moving', dragging || Math.abs(velX) > 0.5 || Math.abs(velY) > 0.5);
      gsap.set(world, { x: camX, y: camY, force3D: true });   // 纯 translate3d:world 大层只平移(GPU 最省),不做 skew 大层重光栅
      recycle();
      updateSpotlight();
    } else {
      inBall = true;   // 标记进入球态渲染(用于切回平面时重置坐标)
      // ── 球 / 平面⇄球过渡态 ──
      renderBall(flat);
    }
  }
  requestAnimationFrame(raf);
}

// 球 morph 渲染:Fibonacci 球面(绕 Y 自转)透视投影,再与平面散布位按 flat 插值(flat=0 纯球,1 纯平面)
function renderBall(flat) {
  gsap.set(world, { x: 0, y: 0 });   // 球态:world 归零,每张图各自屏幕定位
  // 球 morph 时相机 lerp 归位到「画布正中」→ 球/过渡始终居中,不会带着平面拖偏而滑出屏幕
  const camX0 = vw / 2 - cellW / 2, camY0 = vh / 2 - cellH / 2;
  camX = camX0; camY = camY0;   // 球/过渡全程锁死画布正中(不 lerp、不突变 → 放大 morph 全程平滑,不会某帧把图全甩出屏幕)
  targetX = camX; targetY = camY;
  ballRot += BALL_SPIN;
  const R = Math.min(vw, vh) * 0.46 * clamp(0.02, 1, zoom);   // 球半径 ∝ zoom(zoom 1=最大≈页面高)
  const focal = Math.min(vw, vh) * 2;
  const zfade = clamp(0, 1, (zoom - 0.06) / 0.22);   // zoom→0:球缩到中央 + 渐隐(火箭飞远消失)
  const sinR = Math.sin(ballRot), cosR = Math.cos(ballRot);
  for (let i = 0; i < IMG_COUNT; i++) {
    const t = tiles[i], sp = sphere[i];
    const x1 = sp.x * cosR - sp.z * sinR, z1 = sp.x * sinR + sp.z * cosR;   // 绕 Y 自转
    const s = focal / (focal - z1 * R);                                     // 近大远小
    const ballX = vw / 2 + x1 * R * s, ballY = vh / 2 + sp.y * R * s, ballSc = 0.5 * s;
    const ballOp = (z1 + 1) / 2 * 0.7 + 0.3;                                // 近亮远暗
    const flatX = t.wx + camX, flatY = t.wy + camY;
    gsap.set(t.el, {
      x: ballX + (flatX - ballX) * flat - TILE_W / 2,
      y: ballY + (flatY - ballY) * flat - TILE_H / 2,
      scale: ballSc + (1.1 - ballSc) * flat,
      opacity: (ballOp + (1 - ballOp) * flat) * (flat + (1 - flat) * zfade),   // 纯球态随 zoom→0 渐隐消失
      force3D: true,   // translate3d → GPU 合成层,球态 100 张 morph 更顺
    });
    const zi = Math.round((z1 + 1) * 100);   // zIndex 仅档位变化才写,省每帧 100 次 stacking 重算
    if (t._zi !== zi) { t.el.style.zIndex = zi; t._zi = zi; }
  }
  viewport.classList.toggle('moving', true);   // 球态禁 hover
}

// 消失:火箭俯冲缩到中央 + CRT 关机(白亮线收成中央点、啪灭)
function gone() {
  if (phase !== 'roam') return;
  setPhase('gone');
  const cx = vw / 2, cy = vh / 2;
  const els = tiles.map((t) => t.el);
  // CRT 关机:火箭聚中央 → 垂直压成横线 → 水平收成点灭 + 黑屏吞没(无白光,电影黑)
  gsap.timeline()
    .to(els, { x: cx - TILE_W / 2, y: cy - TILE_H / 2, scale: 0.55, duration: 0.16, ease: 'power3.in' }, 0)
    .to(els, { scaleY: 0.006, duration: 0.13, ease: 'power2.in' }, 0.16)   // 压成横线
    .to(els, { scaleX: 0.006, opacity: 0, duration: 0.12, ease: 'power2.in' }, 0.29)   // 收成点灭
    .to(crtEl, { opacity: 1, duration: 0.32, ease: 'power2.in' }, 0.08)   // 黑屏吞没
    .fromTo(dotEl, { opacity: 0, scaleX: 4, scaleY: 1 }, { opacity: 1, scaleX: 1, scaleY: 1, duration: 0.1, ease: 'power2.out' }, 0.34)   // 收成点瞬间:白光余晖(短横→点)啪地一闪
    .to(dotEl, { opacity: 0, scale: 0, duration: 0.32, ease: 'power2.in' }, 0.45);   // 余晖收灭
}

// 重现:gone 态向上滚 → 球从中央重新飞出
function reappear() {
  if (phase !== 'gone') return;
  zoom = 0.4;
  gsap.to(crtEl, { opacity: 0, duration: 0.35, ease: 'power2.out' });   // 黑屏淡出
  gsap.set(dotEl, { opacity: 0 });   // 复位白点余晖
  tiles.forEach((t) => gsap.set(t.el, { opacity: 1, scaleX: 1, scaleY: 1 }));   // 复位缩放(gone 压扁过)
  setPhase('roam');   // renderBall(raf) 接管:zoom 0.4 → 小球从中央出现,继续向上滚变大
}

function init() {
  vw = window.innerWidth || document.documentElement.clientWidth || 1440;
  vh = window.innerHeight || document.documentElement.clientHeight || 900;
  // 画布尺寸 = 按「张数 × 间距² ÷ 密度」定总面积,再按视口宽高比分配 → N 张均匀铺开、间距适中
  const aspect = vw / vh;
  const area = IMG_COUNT * MIN_DIST * MIN_DIST / DENSITY;
  cellH = Math.round(Math.sqrt(area / aspect));
  cellW = Math.round(cellH * aspect);
  // 传入放大后的图尺寸(TILE×1.1)+ 间距,让 makeTiles 做矩形硬约束,彻底消除边角重叠
  tiles = makeTiles(IMG_COUNT, cellW, cellH, MIN_DIST, 1, { w: TILE_W * 1.1, h: TILE_H * 1.1, gap: 26 });   // R2 散布(漫游态目标位)
  sphere = spherePositions(IMG_COUNT, 1);   // 单位球面点(Fibonacci 黄金角) → 球 morph 目标位

  // 相机初始居中到「画布正中」:否则视口停在画布左上角,散布中心(cellW/2)落在视口右下 → 绽放偏右下、取景不均
  camX = targetX = vw / 2 - cellW / 2;
  camY = targetY = vh / 2 - cellH / 2;

  for (const t of tiles) {
    const el = document.createElement('div');
    el.className = 'tile';
    el.innerHTML = `<img src="assets/p${String((t.i % 50) + 1).padStart(2, '0')}.jpg" alt="" draggable="false" />`;   // 50 张彩色原图循环凑 100
    world.appendChild(el);
    t.el = el;
    // 散布目标(世界坐标),但初始堆在视口中心、隐藏,等点击后从中心堆叠→炸散到此
    t.wx = t.pos.scatter.x;
    t.wy = t.pos.scatter.y;
    gsap.set(el, { x: cellW / 2 - TILE_W / 2, y: cellH / 2 - TILE_H / 2, scale: 0.3, opacity: 0 });   // 初始堆在画布正中(world)

    el.addEventListener('mouseenter', () => {
      if (phase !== 'roam' || dragging || zoom < 1.5) return;   // 仅平面漫游态 hover(球态禁)
      el.style.zIndex = 30;
      if (!REDUCE) gsap.to(el, { scale: 1.2, duration: 0.3, ease: 'power2.out', overwrite: 'auto' });   // 浮起放大
    });
    el.addEventListener('mouseleave', () => {
      if (phase !== 'roam' || zoom < 1.5) return;
      el.style.zIndex = '';
      if (!REDUCE) gsap.to(el, { scale: 1.1, duration: 0.4, ease: 'power2.out', overwrite: 'auto' });   // 平滑回落
    });
  }

  hintEl = document.createElement('div');
  hintEl.className = 'hint';
  hintEl.textContent = '点击 / 轻触任意处,让画廊涌现';
  document.body.appendChild(hintEl);

  tipEl = document.createElement('div');   // 散开后短暂操作提示(让人发现滚轮/双指能聚成球)
  tipEl.className = 'tip';
  tipEl.textContent = '滚轮 / 双指缩放 → 聚成星球  ·  拖动漫游  ·  悬停揭色';
  document.body.appendChild(tipEl);

  crtEl = document.createElement('div');   // CRT 关机黑幕
  crtEl.className = 'crt';
  document.body.appendChild(crtEl);
  dotEl = document.createElement('div');   // CRT 关机白光余晖(收成点那一记闪)
  dotEl.className = 'crt-dot';
  document.body.appendChild(dotEl);

  viewport.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  viewport.addEventListener('wheel', onWheel, { passive: false });   // 滚轮:平面⇄球⇄消失 morph
  window.addEventListener('keydown', onKey);   // 方向键平移(无障碍:不靠拖动也能漫游)

  gsap.set(world, { x: camX, y: camY });   // 立刻把相机居中写进 world:否则 idle/入场期 raf 不写 world,涌现堆叠落在画布正中=屏幕外,看不见
  // 调试:?demo=1 直接进漫游态(跳过入场),便于测拖动手感
  if (_q.get('demo')) {
    tiles.forEach((t) => gsap.set(t.el, { x: t.wx, y: t.wy, scale: 1.1, opacity: 1 }));
    setPhase('roam');
  } else {
    setPhase('idle');
  }
  requestAnimationFrame(raf);
}

// 散开进漫游后,短暂提示操作方式(滚轮缩放/拖动/悬停),几秒淡出
function showTip() {
  if (!tipEl) return;
  gsap.killTweensOf(tipEl);
  gsap.fromTo(tipEl, { opacity: 0, y: 8 }, {
    opacity: 0.62, y: 0, duration: 0.7, ease: 'power2.out',
    onComplete() { gsap.to(tipEl, { opacity: 0, duration: 0.9, delay: 2.8 }); },
  });
}

// 减少动效:跳过涌现/爆发,散布态直接淡入到位(前庭安全)
function skipToRoam() {
  setPhase('intro');
  if (hintEl) gsap.to(hintEl, { opacity: 0, duration: 0.3, onComplete: () => { hintEl.style.display = 'none'; } });
  tiles.forEach((t) => gsap.to(t.el, { x: t.wx, y: t.wy, scale: 1.1, opacity: 1, duration: 0.6, ease: 'power2.out' }));
  gsap.delayedCall(0.7, () => { setPhase('roam'); showTip(); });
}

// 入场:中心快速涌现堆叠(大图逐张放大盖住)——只涌现前 25% 就停顿一下 → 炸散
function intro() {
  if (phase !== 'idle') return;
  if (REDUCE) { skipToRoam(); return; }   // 减少动效:走安全淡入
  setPhase('intro');
  if (hintEl) gsap.to(hintEl, { opacity: 0, duration: 0.2, onComplete: () => { hintEl.style.display = 'none'; } });

  const els = tiles.map((t) => t.el);
  els.forEach((el, i) => {
    el.style.zIndex = i;   // 后冒出的盖住先冒出的
    gsap.set(el, {
      x: cellW / 2 - TILE_W / 2 + (Math.random() - 0.5) * 140,
      y: cellH / 2 - TILE_H / 2 + (Math.random() - 0.5) * 90,
      scale: 0.3, opacity: 0,
    });
  });
  // 涌现:从中心逐张放大冒出;stagger 配 power2.out → 前面快速连冒、越往后间隔越大(尾声减速到几乎停)
  gsap.to(els, {
    scale: 1.8, opacity: 1, duration: 0.55, ease: 'power3.out',
    stagger: { amount: SPAWN_DUR, from: 0, ease: 'power2.out' },
  });
  gsap.delayedCall(SPAWN_DUR + 0.55 + HOLD, explode);   // 涌现完 + 停留 HOLD 蓄势 → 散开
}

// 散开(两拍):① 爆发成中央黄金角密铺圆盘(俯视喷泉水花,中央密集冲击)→ 定格 → ② 圆盘向外散成稀疏漫游
function explode() {
  setPhase('explode');
  const els = tiles.map((t) => t.el);
  els.forEach((el) => { el.style.zIndex = ''; });
  const cx = cellW / 2, cy = cellH / 2, R = Math.min(vw, vh) * 0.42;   // 圆盘在画布正中(world),相机已居中 → 显示在视口正中
  // 拍1 目标:中央黄金角密铺圆盘(黄金角 2.399963 与 R2 散布、Fibonacci 聚球同源)
  const disc = tiles.map((t, i) => {
    const a = i * 2.399963, r = Math.sqrt(i / IMG_COUNT) * R;
    return { x: cx + r * Math.cos(a) - TILE_W / 2, y: cy + r * Math.sin(a) - TILE_H / 2 };
  });
  gsap.timeline()
    .to(els, {   // 拍1:从中央堆叠爆发成中央密集圆盘(power4 有力冲击)
      x: (i) => disc[i].x, y: (i) => disc[i].y, scale: 0.82, opacity: 1,
      duration: 0.8, ease: 'power4.out', stagger: { amount: 0.35, from: 'center', grid: 'auto' },
    })
    .to(els, {   // 拍2:圆盘成形后「直接」向四周展开(不定格,一气呵成)
      x: (i) => tiles[i].wx, y: (i) => tiles[i].wy, scale: 1.1, opacity: 1,
      duration: 1.4, ease: 'expo.inOut', stagger: { amount: 0.6, from: 'center', grid: 'auto' },
      onComplete() { setPhase('roam'); showTip(); },   // 进漫游 + 提示操作方式
    });
}

function onDown(e) {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  downX = e.clientX; downY = e.clientY;
  if (pointers.size === 2) {   // 双指:进入 pinch 缩放,退出拖动
    dragging = false;
    const [a, b] = [...pointers.values()];
    pinchDist0 = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    pinchZoom0 = zoom;
    return;
  }
  if (phase !== 'roam' || zoom < 1.5) return;   // 球态单指不拖动,只自转 + pinch
  dragging = true;
  lastPX = e.clientX; lastPY = e.clientY;
  velX = velY = 0;
  try { viewport.setPointerCapture(e.pointerId); } catch (_) {}
}

function onMove(e) {
  mx = e.clientX; my = e.clientY;   // 追光光标:任何移动都更新
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {   // 双指 pinch:捏合→收球→捏到底 CRT 关机 / 张开→还原→黑屏态张开重现
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    if (phase === 'gone') { if (dist > pinchDist0 * 1.3) reappear(); return; }   // 黑屏态两指张开 → 重现
    if (phase === 'roam') {
      const nz = pinchZoom0 * (dist / pinchDist0);
      if (nz < 0.14) { gone(); return; }   // 捏到底 → CRT 关机消失
      zoom = clamp(0.14, 2.0, nz);
    }
    return;
  }
  if (!dragging) return;
  const dx = e.clientX - lastPX, dy = e.clientY - lastPY;
  targetX += dx; targetY += dy;   // 只推 target,画面由 raf 的 lerp 平滑跟上
  velX = velX * 0.55 + dx * 0.45;   // 平滑最近几帧速度:方向更稳、精准贴合手势方向,不受松手瞬间抖动影响
  velY = velY * 0.55 + dy * 0.45;
  lastPX = e.clientX; lastPY = e.clientY;
}

function onUp(e) {
  pointers.delete(e.pointerId);
  if (pointers.size === 1) {   // pinch 松开一指、剩单指:重设拖动基准,避免下次移动跳变
    const [p] = [...pointers.values()];
    lastPX = downX = p.x; lastPY = downY = p.y;
  }
  const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
  if (dragging) {
    dragging = false;
    // 惯性朝「本次拖动的整体方向」给(起点→终点),不依赖松手瞬间速度 → 你往哪拖,松手就往哪滚一段
    if (moved > 10) {
      const speed = Math.min(moved * FLING, 100);
      velX = (e.clientX - downX) / moved * speed;
      velY = (e.clientY - downY) / moved * speed;
    } else {
      velX = velY = 0;
    }
    try { viewport.releasePointerCapture(e.pointerId); } catch (_) {}
  }
  if (moved < 8 && phase === 'idle') intro();   // 空态点击 → 入场
}

// 滚轮:控制平面⇄球 morph —— 向下滚 zoom 减 → 收拢成球 + 缩小;向上滚 zoom 增 → 球变大 → ≥1.6 炸回平面
function onWheel(e) {
  if (phase === 'gone') {   // 消失态:向上滚 → 球从中央重现
    if (e.deltaY < 0) { e.preventDefault(); reappear(); }
    return;
  }
  if (phase !== 'roam') return;
  e.preventDefault();
  const nz = zoom - e.deltaY * 0.0015;
  if (nz < 0.14 && e.deltaY > 0) { gone(); return; }   // 滚到底 → 火箭俯冲 + CRT 关机消失
  zoom = clamp(0.14, 2.0, nz);   // 0.14=最小球(再往下触发消失) / 1=球最大 / ≥1.6=平面
}

// 方向键漫游(a11y):给相机一个脉冲,借用惯性平滑滑动
function onKey(e) {
  if (phase !== 'roam' || zoom < 1.5) return;
  const K = 60;
  if (e.key === 'ArrowLeft') velX += K;
  else if (e.key === 'ArrowRight') velX -= K;
  else if (e.key === 'ArrowUp') velY += K;
  else if (e.key === 'ArrowDown') velY -= K;
  else return;
  e.preventDefault();
}

if (document.readyState === 'complete') init();
else window.addEventListener('load', init);

// 调试出口(默认关闭,?debug=1 启用):在 rAF 冻结的预览里逐帧手动推进 raf + 读真实状态,便于抓 bug
if (_q.get('debug')) {
  window.__dbg = () => ({ camX: Math.round(camX), camY: Math.round(camY), velX: +velX.toFixed(2), velY: +velY.toFixed(2), phase, dragging, zoom: +zoom.toFixed(2), pinchN: pointers.size });
  window.__step = () => { camX += velX; camY += velY; velX *= FRICTION; velY *= FRICTION; gsap.set(world, { x: camX, y: camY }); recycle(); return { camX: Math.round(camX), velX: +velX.toFixed(2) }; };
  window.__frame = () => { raf(); return window.__dbg(); };   // 手动推进一帧完整 raf(含球 morph/平面切换)
  window.__tileRect = (i = 0) => { const r = tiles[i].el.getBoundingClientRect(); return { cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2), inView: r.right > 0 && r.left < vw && r.bottom > 0 && r.top < vh }; };   // 用内部 vw/vh:pane 里 window.innerWidth=0 会误判出界
  window.__vw = () => ({ vw, vh, cellW, cellH });
}
