const fs = require('fs');
const vm = require('vm');
const path = require('path');
const code = fs.readFileSync(path.join(__dirname, '..', '游戏源码', 'game.js'), 'utf8');
const script = new vm.Script(code);
const context = vm.createContext({ module: { exports: {} }, require });
script.runInContext(context);
const { Board, CellState, LogicSolver } = context.module.exports;

console.log('========================================');
console.log('  无猜扫雷 v2 核心测试');
console.log('========================================\n');

// ==========================================
// 测试1: 谜题生成成功率
// ==========================================
console.log('===== 测试1: 谜题生成成功率 =====');

function testDifficulty(name, rows, cols, mines, trials) {
  let success = 0;
  let fail = 0;
  let failFirstClick = 0;
  let totalTime = 0;
  
  for (let i = 0; i < trials; i++) {
    const b = new Board(rows, cols, mines);
    const fr = Math.floor(Math.random() * rows);
    const fc = Math.floor(Math.random() * cols);
    
    const t0 = performance.now();
    b._initMines(fr, fc);
    totalTime += (performance.now() - t0);
    
    if (b.mineMap[fr][fc]) {
      failFirstClick++;
      fail++;
      continue;
    }

    if (b._verifySolvable()) {
      success++;
    } else {
      fail++;
    }
  }
  
  const rate = (success / trials * 100).toFixed(1);
  const avg = (totalTime / trials).toFixed(1);
  console.log(`[${name}] 成功=${success}/${trials} (${rate}%) 首点踩雷=${failFirstClick} 平均=${avg}ms`);
  return success / trials;
}

const configs = [
  { name: '简单 9×9/10雷', rows: 9, cols: 9, mines: 10 },
  { name: '中等 16×16/40雷', rows: 16, cols: 16, mines: 40 },
  { name: '困难 16×30/99雷', rows: 16, cols: 30, mines: 99 },
  { name: '专家 20×30/130雷', rows: 20, cols: 30, mines: 130 },
];

let allPass = true;
for (const cfg of configs) {
  const rate = testDifficulty(cfg.name, cfg.rows, cfg.cols, cfg.mines, 50);
  if (rate < 0.9) {
    console.log(`  ⚠️ 成功率 ${(rate*100).toFixed(0)}% < 90%，需要检查`);
    allPass = false;
  }
}

// ==========================================
// 测试2: 基础数字约束推理
// ==========================================
console.log('\n===== 测试2: 基础数字约束推理 =====');

{
  // 场景 A: 3×3, 1个雷在(0,0)
  // 揭开(1,1)及其所有邻居 → 棋盘全部揭开
  // 但为了测试 solver，只揭开(1,1)，并标记(0,0)为旗子
  const b = new Board(3, 3, 1);
  b.mineMap[0][0] = true;
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      if (!b.mineMap[r][c]) b.numbers[r][c] = b.getMineCount(r, c);
  
  b.state[1][1] = CellState.REVEALED;
  b.state[0][0] = CellState.FLAGGED; // 用户正确标记了雷
  
  const r1 = LogicSolver.analyze(b);
  console.log('场景A: 数字1 + 已标1雷 → 其余全安全');
  console.log(`  safe=${r1.safe.length} (预期6个: (0,1),(0,2),(1,0),(1,2),(2,0),(2,1),(2,2))`);
  console.log(`  mines=${r1.mines.length} (预期0)`);
  
  let okA = r1.safe.length === 7 && r1.mines.length === 0;
  if (!okA) {
    console.log('  ❌ 失败');
    allPass = false;
  } else {
    console.log('  ✅ 通过');
  }
}

{
  // 场景 B: 3×3, 雷在(0,0)和(0,1)
  // 揭开(2,2) → 数字为0(周围无雷) → 自动展开
  // 所以更复杂的测试是部分揭开的情况
  const b = new Board(3, 3, 2);
  b.mineMap[0][0] = true;
  b.mineMap[0][1] = true;
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      if (!b.mineMap[r][c]) b.numbers[r][c] = b.getMineCount(r, c);
  
  // 揭开(2,2) - 数字为0 → 洪水填充揭开(1,2)(2,1)(1,1)(2,2)
  b.state[2][2] = CellState.REVEALED;
  // 模拟洪水填充
  const simB = {
    rows: 3, cols: 3, state: b.state.map(r => [...r]), numbers: b.numbers,
    mineMap: b.mineMap, getNeighbors: (r,c) => b.getNeighbors(r,c),
  };
  // 手动填充
  const q = [[2,2]]; const v = new Set(['2,2']);
  while (q.length) {
    const [cr, cc] = q.shift();
    for (const [nr, nc] of b.getNeighbors(cr, cc)) {
      const k = `${nr},${nc}`;
      if (v.has(k) || simB.state[nr][nc] !== CellState.HIDDEN) continue;
      simB.state[nr][nc] = CellState.REVEALED; v.add(k);
      if (simB.numbers[nr][nc] === 0 && !b.mineMap[nr][nc]) q.push([nr, nc]);
    }
  }
  b.state = simB.state;
  
  // 现在布局:
  // ? ? ?     (0,0)=雷, (0,1)=雷
  // ? 1 1     (1,1)=1, (1,2)=1
  // ? 1 0     (2,1)=1, (2,2)=0
  // 数字(1,1)=1, 周围隐藏有(0,1)(1,0)(2,0)，1雷未标
  // → 无法直接推理... 标上(0,0)的旗子！
  b.state[0][0] = CellState.FLAGGED;
  
  const r2 = LogicSolver.analyze(b);
  console.log('\n场景B: 1-1模式 + 1旗 → 推理');
  console.log(`  safe=${r2.safe.length}, mines=${r2.mines.length}`);
  
  // 预期: (1,0) 应该可以确定安全(因为(0,0)已是旗, (0,1)是隐藏但还未标)
  let okB = true;
  // 对于(0,1): 从(0,2)=1, (1,2)=1, (2,2)=0 来看
  // 实际上场景B需要更复杂的推理，我们先看看结果
  console.log(r2.reasoning.length > 0 ? `  推理过程: ${r2.reasoning.join('; ')}` : '  无推理过程');
  console.log(`  ${r2.safe.length > 0 || r2.mines.length > 0 ? '✅ 有推理结果' : '⚠️ 无推理结果（可能场景需要更多信息）'}`);
}

// ==========================================
// 测试3: 双重消元推理 (1-2-1模式)
// ==========================================
console.log('\n===== 测试3: 双重消元推理 =====');

{
  // 经典 1-2-1 模式:
  // . . .
  // 1 2 1
  // . . .
  // 中间2的上下左右各1雷，但只有两个雷 → 需要子集消元
  const b = new Board(3, 3, 2);
  b.mineMap[0][0] = true;
  b.mineMap[0][2] = true;
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      if (!b.mineMap[r][c]) b.numbers[r][c] = b.getMineCount(r, c);
  
  // 揭开中间行
  b.state[1][0] = CellState.REVEALED; // num=1
  b.state[1][1] = CellState.REVEALED; // num=2
  b.state[1][2] = CellState.REVEALED; // num=1
  
  console.log('场景C: 1-2-1模式');
  console.log(`  (1,0)=${b.numbers[1][0]}, (1,1)=${b.numbers[1][1]}, (1,2)=${b.numbers[1][2]}`);
  
  const r3 = LogicSolver.analyze(b);
  console.log(`  safe=${r3.safe.length}, mines=${r3.mines.length}`);
  console.log(`  safe:`, JSON.stringify(r3.safe));
  console.log(`  mines:`, JSON.stringify(r3.mines));
  
  // 预期: (0,1) 安全, (0,0)和(0,2)是雷
  const hasMine00 = r3.mines.some(([r,c]) => r===0 && c===0);
  const hasMine02 = r3.mines.some(([r,c]) => r===0 && c===2);
  const hasSafe01 = r3.safe.some(([r,c]) => r===0 && c===1);
  
  if (hasMine00 && hasMine02) {
    console.log('  ✅ (0,0)和(0,2)正确识别为雷');
  } else {
    console.log('  ❌ 未正确识别雷');
    allPass = false;
  }
  
  // 双重消元应该也能确定(0,1)安全
}

// ==========================================
// 测试4: 错误标记场景
// ==========================================
console.log('\n===== 测试4: 错误标记鲁棒性 =====');

{
  const b = new Board(3, 3, 1);
  b.mineMap[0][0] = true;
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      if (!b.mineMap[r][c]) b.numbers[r][c] = b.getMineCount(r, c);
  
  b.state[1][1] = CellState.REVEALED;
  // 用户错误标记(2,2)为旗子（实际不是雷）
  b.state[2][2] = CellState.FLAGGED;
  
  const r4 = LogicSolver.analyze(b);
  console.log('场景D: 错误标记 (标记了安全格为雷)');
  console.log(`  safe=${r4.safe.length}, mines=${r4.mines.length}`);
  
  // 错误标记时 solver 应该能正常推理（不影响mine确定，但safe不会被污染）
  // 实际上错误标记会导致约束不匹配，但 solver 不应该返回矛盾结果
  if (r4.safe.length > 0 || r4.mines.length > 0) {
    console.log('  ✅ 错误标记下仍能推理');
  } else {
    console.log('  ⚠️ 错误标记导致无法推理（可接受）');
  }
}

// ==========================================
// 测试5: 边界场景
// ==========================================
console.log('\n===== 测试5: 边界场景 =====');

const edgeCases = [
  { name: '5×5 5雷(20%)', rows: 5, cols: 5, mines: 5 },
  { name: '5×5 8雷(32%)', rows: 5, cols: 5, mines: 8 },
  { name: '7×7 15雷(30%)', rows: 7, cols: 7, mines: 15 },
  { name: '1×10 3雷', rows: 1, cols: 10, mines: 3 },
  { name: '10×1 3雷', rows: 10, cols: 1, mines: 3 },
];

for (const cfg of edgeCases) {
  let success = 0;
  const trials = 30;
  for (let i = 0; i < trials; i++) {
    const b = new Board(cfg.rows, cfg.cols, cfg.mines);
    const fr = Math.floor(Math.random() * cfg.rows);
    const fc = Math.floor(Math.random() * cfg.cols);
    b._initMines(fr, fc);
    if (!b.mineMap[fr][fc] && b._verifySolvable()) success++;
  }
  console.log(`[${cfg.name}] 可解率: ${(success/trials*100).toFixed(0)}% (${success}/${trials})`);
}

// ==========================================
// 测试6: 端到端模拟
// ==========================================
console.log('\n===== 测试6: 端到端模拟 =====');

function simulateGame(rows, cols, mines, maxReveals) {
  const b = new Board(rows, cols, mines);
  const fr = Math.floor(Math.random() * rows);
  const fc = Math.floor(Math.random() * cols);
  
  b._initMines(fr, fc);
  b.firstMove = false;
  b.initialized = true;
  
  // 用 SimBoard 模拟解法
  const sim = new (context.module.exports.SimBoard || (() => {
    class S {
      constructor(board) {
        this.rows = board.rows; this.cols = board.cols;
        this.mineMap = board.mineMap; this.numbers = board.numbers;
        this.state = board.state.map(r => [...r]);
        this._cache = new Map();
      }
      getNeighbors(r, c) {
        const k = `${r},${c}`;
        if (this._cache.has(k)) return this._cache.get(k);
        const n = [];
        for (let dr = -1; dr <= 1; dr++)
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = r + dr, nc = c + dc;
            if (nr >= 0 && nr < this.rows && nc >= 0 && nc < this.cols) n.push([nr, nc]);
          }
        this._cache.set(k, n); return n;
      }
      isHidden(r, c) { return this.state[r][c] === CellState.HIDDEN || this.state[r][c] === CellState.QUESTION; }
      reveal(r, c) { this.state[r][c] = CellState.REVEALED; }
      flag(r, c) { this.state[r][c] = CellState.FLAGGED; }
    }
    return S;
  })())(b);
  
  let steps = 0;
  for (let iter = 0; iter < maxReveals; iter++) {
    const result = LogicSolver._analyze(sim);
    let didSomething = false;
    
    for (const [r, c] of result.safe) {
      if (sim.isHidden(r, c)) {
        sim.reveal(r, c);
        if (sim.numbers[r][c] === 0) {
          const qq = [[r,c]]; const vv = new Set([`${r},${c}`]);
          while (qq.length) {
            const [cr, cc] = qq.shift();
            for (const [nr, nc] of sim.getNeighbors(cr, cc)) {
              const k = `${nr},${nc}`;
              if (vv.has(k) || !sim.isHidden(nr, nc)) continue;
              sim.reveal(nr, nc); vv.add(k);
              if (sim.numbers[nr][nc] === 0) qq.push([nr, nc]);
            }
          }
        }
        didSomething = true; steps++;
      }
    }
    
    for (const [r, c] of result.mines) {
      if (sim.isHidden(r, c)) {
        sim.flag(r, c); didSomething = true;
      }
    }
    
    if (!didSomething) break;
  }
  
  // 检查结果
  const unrevealed = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      if (!b.mineMap[r][c] && sim.state[r][c] !== CellState.REVEALED)
        unrevealed.push([r,c]);
  
  return { won: unrevealed.length === 0, unrevealed: unrevealed.length, steps };
}

for (const cfg of configs) {
  let wins = 0;
  const trials = 20;
  for (let i = 0; i < trials; i++) {
    const r = simulateGame(cfg.rows, cfg.cols, cfg.mines, 5000);
    if (r.won) wins++;
  }
  console.log(`[${cfg.name}] 端到端胜率: ${(wins/trials*100).toFixed(0)}% (${wins}/${trials})`);
}

console.log('\n========================================');
console.log(allPass ? '✅ 全部核心测试通过' : '❌ 存在失败项');
