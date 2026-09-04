const fs = require('fs');
const vm = require('vm');
const path = require('path');
const code = fs.readFileSync(path.join(__dirname, '..', '游戏源码', 'game.js'), 'utf8');
const script = new vm.Script(code);
const context = vm.createContext({ module: { exports: {} }, require });
script.runInContext(context);
const { Board, CellState, LogicSolver } = context.module.exports;

console.log('===== 1-2-1 模式深入测试 =====');

// 经典 1-2-1: 一个更大的棋盘
// . . . . .
// 1 2 2 1 .
// . . . . .
// 两个雷在(0,1)和(0,3)
{
  const b = new Board(3, 5, 2);
  b.mineMap[0][1] = true;
  b.mineMap[0][3] = true;
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 5; c++)
      if (!b.mineMap[r][c]) b.numbers[r][c] = b.getMineCount(r, c);
  
  // 揭开中间行
  for (let c = 0; c < 5; c++) {
    b.state[1][c] = CellState.REVEALED;
  }
  
  console.log('布局:');
  for (let r = 0; r < 3; r++) {
    let line = '';
    for (let c = 0; c < 5; c++) {
      if (b.state[r][c] === CellState.REVEALED) line += ` ${b.numbers[r][c]} `;
      else if (b.mineMap[r][c]) line += ' M ';
      else line += ' . ';
    }
    console.log(line);
  }
  
  console.log('\n数字:');
  for (let c = 0; c < 5; c++) {
    console.log(`  (1,${c})=${b.numbers[1][c]}`);
  }
  
  const result = LogicSolver.analyze(b);
  console.log(`\n推理结果:`);
  console.log(`  safe: ${result.safe.length}个`, JSON.stringify(result.safe));
  console.log(`  mines: ${result.mines.length}个`, JSON.stringify(result.mines));
  console.log(`  推理过程: ${result.reasoning.join('; ')}`);
  
  // 预期: (0,0)(0,2)(0,4) 安全, (0,1)(0,3) 是雷 ?
  // 检查子集消元: 
  // 约束(1,0): num=1, 邻居=[(0,0),(0,1),(2,0),(2,1),(1,0是不对的)] ...
  // 实际上(1,0)=1 的邻居有 (0,0)=hidden (0,1)=hidden (2,0)=hidden (2,1)=hidden
  // 不对，让我重新看布局
  
  // (1,0)的邻居: (0,0),(0,1),(2,0),(2,1)  —— 确保这些都没揭开
  // (1,1)=2 邻居: (0,0),(0,1),(0,2),(2,0),(2,1),(2,2) —— 注意(0,1)是雷所以计数+1
  // (1,2)=2 邻居: (0,1),(0,2),(0,3),(2,1),(2,2),(2,3) 
  // (1,3)=1 邻居: (0,2),(0,3),(0,4),(2,2),(2,3),(2,4)
  
  // 所以约束:
  // C0: (1,0)=1, 隐藏4个, 1雷 → 剩余1雷
  // C1: (1,1)=2, 隐藏6个, 2雷 → 剩余2雷  —— 注意(0,1)是雷
  // 子集: C0 ⊆ C1? C0的{(0,0),(0,1),(2,0),(2,1)} ⊆ C1的{(0,0),(0,1),(0,2),(2,0),(2,1),(2,2)}
  //   → 是的! diff = {(0,2),(2,2)}, mineDiff = 2-1 = 1
  //   → diff有2个格子但mineDiff=1 → 不能确定...
  
  // 需要 C1 ⊆ C0 ? C1不是C0的子集
  
  // 更复杂的子集推理需要 C0+C1+C2 的组合... 
  // 经典的1-2-1实际需要3个约束联合推理
}

console.log('\n\n===== 更多模式测试 =====');

// 测试: 简单"角落"模式
// 1 1
// 1 .
// 三个1围着一个隐藏，只有1个雷
{
  const b = new Board(2, 2, 1);
  b.mineMap[0][0] = true;
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < 2; c++)
      if (!b.mineMap[r][c]) b.numbers[r][c] = b.getMineCount(r, c);
  
  // 2×2 棋盘，只有4格，1个雷
  // 揭开(0,1),(1,0),(1,1)  
  b.state[0][1] = CellState.REVEALED;
  b.state[1][0] = CellState.REVEALED;
  b.state[1][1] = CellState.REVEALED;
  
  console.log('2×2 角落模式:');
  console.log(`  (0,0): 隐藏 (实际是${b.mineMap[0][0] ? '雷' : '安全'})`);
  console.log(`  (0,1): ${b.numbers[0][1]} (已揭开)`);
  console.log(`  (1,0): ${b.numbers[1][0]} (已揭开)`);
  console.log(`  (1,1): ${b.numbers[1][1]} (已揭开)`);
  
  const r2 = LogicSolver.analyze(b);
  console.log(`  safe: ${r2.safe.length}`, JSON.stringify(r2.safe));
  console.log(`  mines: ${r2.mines.length}`, JSON.stringify(r2.mines));
  console.log(`  推理: ${r2.reasoning.join('; ')}`);
  
  // 预期: (0,0) 是雷！因为三个数字都是1，它们的唯一共同邻居就是(0,0)
  if (r2.mines.some(([r,c]) => r===0 && c===0)) {
    console.log('  ✅ 正确推理出(0,0)是雷');
  } else {
    console.log('  ❌ 未能推理出(0,0)是雷');
  }
}

// 测试: 边界0展开+推理
console.log('\n===== 数字0自动展开测试 =====');

{
  const b = new Board(5, 5, 3);
  b.mineMap[0][0] = true;
  b.mineMap[4][4] = true;
  b.mineMap[2][2] = true;
  for (let r = 0; r < 5; r++)
    for (let c = 0; c < 5; c++)
      if (!b.mineMap[r][c]) b.numbers[r][c] = b.getMineCount(r, c);
  
  // 点击(0,2) — 只要不是0就手动展开
  b.state[0][2] = CellState.REVEALED;
  // 这个位置数字是多少？
  console.log(`(0,2) 数字: ${b.numbers[0][2]}`);
  
  // 如果是0则自动展开
  const sim2 = {
    rows: 5, cols: 5, state: b.state.map(r => [...r]), numbers: b.numbers,
    getNeighbors: (r,c) => b.getNeighbors(r,c),
  };
  
  // 自动展开
  if (b.numbers[0][2] === 0) {
    const qq = [[0,2]]; const vv = new Set(['0,2']);
    while (qq.length) {
      const [cr, cc] = qq.shift();
      for (const [nr, nc] of b.getNeighbors(cr, cc)) {
        const k = `${nr},${nc}`;
        if (vv.has(k) || (b.state[nr][nc] !== CellState.HIDDEN)) continue;
        b.state[nr][nc] = CellState.REVEALED; vv.add(k);
        if (b.numbers[nr][nc] === 0) qq.push([nr, nc]);
      }
    }
  }
  
  let revealedCount = 0;
  for (let r = 0; r < 5; r++)
    for (let c = 0; c < 5; c++)
      if (b.state[r][c] === CellState.REVEALED) revealedCount++;
  
  console.log(`点击(0,2)后展开格数: ${revealedCount}`);
  
  // 验证 solver 能继续推理
  const r3 = LogicSolver.analyze(b);
  console.log(`solver 找到 safe=${r3.safe.length}, mines=${r3.mines.length}`);
  console.log(`推理: ${r3.reasoning.join('; ')}`);
}

console.log('\n===== 全部测试完成 =====');
