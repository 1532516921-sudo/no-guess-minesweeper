const fs = require('fs');
const path = require('path');
const code = fs.readFileSync(path.join(__dirname, '..', '游戏源码', 'game.js'), 'utf8');
// 在模块作用域中执行代码，将定义绑定到全局
const vm = require('vm');
const script = new vm.Script(code);
const context = vm.createContext({ module: { exports: {} }, require });
script.runInContext(context);
const { Board, CellState, LogicSolver } = context.module.exports;

// ============================================================
// 测试1: 谜题生成成功率
// ============================================================
console.log('===== 测试1: 谜题生成成功率 =====');

function testDifficulty(name, rows, cols, mines, trials) {
  let success = 0;
  let fail = 0;
  let totalInitTime = 0;
  let totalVerifyTime = 0;
  let maxAttemptsNeeded = 0;
  
  for (let i = 0; i < trials; i++) {
    const b = new Board(rows, cols, mines);
    const fr = Math.floor(Math.random() * rows);
    const fc = Math.floor(Math.random() * cols);
    
    const t0 = performance.now();
    b._initMines(fr, fc);
    const t1 = performance.now();
    
    // 验证不踩雷
    if (b.mineMap[fr][fc]) {
      fail++;
      console.log(`  [${name}] 尝试${i+1}: 首次点击位置是雷!`);
      continue;
    }

    // 验证谜题是否可解
    const solvable = b._verifySolvable();
    const t2 = performance.now();
    
    totalInitTime += (t1 - t0);
    totalVerifyTime += (t2 - t1);
    
    if (solvable) {
      success++;
    } else {
      fail++;
      console.log(`  [${name}] 尝试${i+1}: 谜题不可解`);
    }
  }
  
  console.log(`[${name}]  ${trials}次测试:`);
  console.log(`  成功: ${success}, 失败: ${fail}, 成功率: ${(success/trials*100).toFixed(1)}%`);
  console.log(`  平均生成时间: ${(totalInitTime/trials).toFixed(1)}ms`);
  console.log(`  平均验证时间: ${(totalVerifyTime/trials).toFixed(1)}ms`);
  return success / trials;
}

const configs = [
  { name: '简单 9x9/10雷', rows: 9, cols: 9, mines: 10 },
  { name: '中等 16x16/40雷', rows: 16, cols: 16, mines: 40 },
  { name: '困难 16x30/99雷', rows: 16, cols: 30, mines: 99 },
];

let allPass = true;
for (const cfg of configs) {
  const rate = testDifficulty(cfg.name, cfg.rows, cfg.cols, cfg.mines, 30);
  if (rate < 0.8) {
    console.log(`  ⚠️ 成功率低于80%，需要优化`);
    allPass = false;
  }
}

// ============================================================
// 测试2: 逻辑求解器 - 基础场景
// ============================================================
console.log('\n===== 测试2: 基础推理场景 =====');

{
  // 场景: 3x3, 1个雷在(0,0), 揭开中心(1,1)
  const b = new Board(3, 3, 1);
  b.mineMap[0][0] = true;
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      if (!b.mineMap[r][c]) b.numbers[r][c] = b.getMineCount(r, c);
  
  b.state[1][1] = CellState.REVEALED;
  const num = b.numbers[1][1];
  console.log(`场景1 - 中心数字: ${num} (应为1)`);
  
  const result = LogicSolver.analyze(b);
  console.log(`  可安全揭开: ${result.safe.length}个, 可标雷: ${result.mines.length}个`);
  
  // 验证数字1周围: (0,1),(1,0),(1,2),(2,0),(2,1),(2,2)可安全揭开
  // 数字1周围: (0,0)可标雷
  const expectedSafe = [[0,1],[1,0],[1,2],[2,0],[2,1],[2,2]];
  const expectedMines = [[0,0]];
  let ok = true;
  for (const [r,c] of expectedSafe) {
    if (!result.safe.some(([sr,sc]) => sr===r && sc===c)) { ok = false; console.log(`  缺少safe(${r},${c})`); }
  }
  for (const [r,c] of expectedMines) {
    if (!result.mines.some(([mr,mc]) => mr===r && mc===c)) { ok = false; console.log(`  缺少mine(${r},${c})`); }
  }
  console.log(`  场景1: ${ok ? '✅ 通过' : '❌ 失败'}`);
  if (!ok) allPass = false;
}

// ============================================================
// 测试3: 子集消元场景
// ============================================================
console.log('\n===== 测试3: 子集消元推理 =====');

{
  // 3x3, 2个雷在(1,1)和(2,2)
  // 揭开的数字:
  // 1 1 1
  // 1 ? ?
  // 1 ? ?
  const b = new Board(3, 3, 2);
  b.mineMap[1][1] = true;
  b.mineMap[2][2] = true;
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      if (!b.mineMap[r][c]) b.numbers[r][c] = b.getMineCount(r, c);
  
  // 揭开边缘
  b.state[0][0] = CellState.REVEALED;
  b.state[0][1] = CellState.REVEALED;
  b.state[0][2] = CellState.REVEALED;
  b.state[1][0] = CellState.REVEALED;
  b.state[2][0] = CellState.REVEALED;
  
  console.log('数字- (0,0):', b.numbers[0][0], '(0,1):', b.numbers[0][1], '(0,2):', b.numbers[0][2]);
  console.log('数字- (1,0):', b.numbers[1][0], '(2,0):', b.numbers[2][0]);
  
  const result = LogicSolver.analyze(b);
  console.log(`  可安全揭开: ${result.safe.length}个 (预期2: (1,2),(2,1))`);
  console.log(`  可标雷: ${result.mines.length}个 (预期2: (1,1),(2,2))`);
  
  const expectedSafe = [[1,2],[2,1]];
  const expectedMines = [[1,1],[2,2]];
  let ok = true;
  for (const [r,c] of expectedSafe) {
    if (!result.safe.some(([sr,sc]) => sr===r && sc===c)) { ok = false; console.log(`  缺少safe(${r},${c})`); }
  }
  for (const [r,c] of expectedMines) {
    if (!result.mines.some(([mr,mc]) => mr===r && mc===c)) { ok = false; console.log(`  缺少mine(${r},${c})`); }
  }
  // 确保没有额外的错误结论
  if (result.mines.length > 2 || result.safe.length > 2) {
    ok = false;
    console.log(`  有多余的推理结果`);
  }
  console.log(`  场景2: ${ok ? '✅ 通过' : '❌ 失败'}`);
  if (!ok) allPass = false;
}

// ============================================================
// 测试4: 边界场景 - 极限密度
// ============================================================
console.log('\n===== 测试4: 边界压力场景 =====');

// 高密度小棋盘
const denseConfigs = [
  { name: '5x5 5雷(20%)', rows: 5, cols: 5, mines: 5 },
  { name: '5x5 8雷(32%)', rows: 5, cols: 5, mines: 8 },
  { name: '7x7 15雷(30%)', rows: 7, cols: 7, mines: 15 },
  { name: '1x10 3雷', rows: 1, cols: 10, mines: 3 },
  { name: '10x1 3雷', rows: 10, cols: 1, mines: 3 },
];

for (const cfg of denseConfigs) {
  let success = 0;
  const trials = 20;
  for (let i = 0; i < trials; i++) {
    const b = new Board(cfg.rows, cfg.cols, cfg.mines);
    const fr = Math.floor(Math.random() * cfg.rows);
    const fc = Math.floor(Math.random() * cfg.cols);
    
    b._initMines(fr, fc);
    
    if (b.mineMap[fr][fc]) continue;
    if (b._verifySolvable()) success++;
  }
  console.log(`[${cfg.name}] 可解率: ${(success/trials*100).toFixed(0)}% (${success}/${trials})`);
}

// ============================================================
// 测试5: 端到端模拟游戏
// ============================================================
console.log('\n===== 测试5: 端到端游戏模拟 =====');

function simulateGame(rows, cols, mines) {
  const b = new Board(rows, cols, mines);
  const fr = Math.floor(Math.random() * rows);
  const fc = Math.floor(Math.random() * cols);
  
  b._initMines(fr, fc);
  
  // 模拟揭开 - 始终使用 solver 决定下一步
  const sim = {
    rows: b.rows, cols: b.cols,
    state: b.state.map(row => [...row]),
    numbers: b.numbers,
    mineMap: b.mineMap,
    getNeighbors: (rr, cc) => b.getNeighbors(rr, cc),
  };
  
  let steps = 0;
  const maxSteps = rows * cols;
  
  // 先自动揭开放入
  const queue = [[fr, fc]];
  const visited = new Set([`${fr},${fc}`]);
  while (queue.length) {
    const [cr, cc] = queue.shift();
    if (sim.state[cr][cc] !== CellState.REVEALED) {
      sim.state[cr][cc] = CellState.REVEALED;
      steps++;
    }
    if (sim.numbers[cr][cc] === 0) {
      for (const [nr, nc] of b.getNeighbors(cr, cc)) {
        const key = `${nr},${nc}`;
        if (!visited.has(key) && (sim.state[nr][nc] === CellState.HIDDEN || sim.state[nr][nc] === CellState.QUESTION)) {
          visited.add(key);
          queue.push([nr, nc]);
        }
      }
    }
  }
  
  // 然后用 solver 循环解
  let changed = true;
  while (changed && steps < maxSteps) {
    changed = false;
    const result = LogicSolver._analyze(sim);
    
    for (const [r, c] of result.safe) {
      if (sim.state[r][c] === CellState.HIDDEN || sim.state[r][c] === CellState.QUESTION) {
        sim.state[r][c] = CellState.REVEALED;
        steps++;
        changed = true;
        if (sim.numbers[r][c] === 0) {
          const q2 = [[r, c]];
          const v2 = new Set([`${r},${c}`]);
          while (q2.length) {
            const [cr, cc] = q2.shift();
            for (const [nr, nc] of b.getNeighbors(cr, cc)) {
              const key = `${nr},${nc}`;
              if (!v2.has(key) && (sim.state[nr][nc] === CellState.HIDDEN || sim.state[nr][nc] === CellState.QUESTION)) {
                sim.state[nr][nc] = CellState.REVEALED;
                steps++;
                v2.add(key);
                if (sim.numbers[nr][nc] === 0) q2.push([nr, nc]);
              }
            }
          }
        }
      }
    }
    
    for (const [r, c] of result.mines) {
      if (sim.state[r][c] === CellState.HIDDEN || sim.state[r][c] === CellState.QUESTION) {
        sim.state[r][c] = CellState.FLAGGED;
        changed = true;
      }
    }
  }
  
  // 检查结果
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!b.mineMap[r][c] && sim.state[r][c] !== CellState.REVEALED) {
        return { won: false, steps, remaining: `${r},${c}` };
      }
    }
  }
  return { won: true, steps };
}

const gameConfigs = [
  { name: '9x9/10雷', rows: 9, cols: 9, mines: 10 },
  { name: '16x16/40雷', rows: 16, cols: 16, mines: 40 },
];

for (const cfg of gameConfigs) {
  let wins = 0;
  const trials = 10;
  for (let i = 0; i < trials; i++) {
    const result = simulateGame(cfg.rows, cfg.cols, cfg.mines);
    if (result.won) wins++;
    else console.log(`  [${cfg.name}] 模拟${i+1}: 失败 - 卡在(${result.remaining})`);
  }
  console.log(`[${cfg.name}] 端到端胜率: ${(wins/trials*100).toFixed(0)}% (${wins}/${trials})`);
}

console.log('\n========================================');
console.log(`整体结果: ${allPass ? '✅ 全部通过' : '❌ 存在问题需要修复'}`);
