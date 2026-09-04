const fs = require('fs');
const vm = require('vm');
const path = require('path');
const code = fs.readFileSync(path.join(__dirname, '..', '游戏源码', 'game.js'), 'utf8');
const script = new vm.Script(code);
const context = vm.createContext({ module: { exports: {} }, require });
script.runInContext(context);
const { Board, CellState, LogicSolver } = context.module.exports;

console.log('===== 真正的 1-2-1 模式 =====\n');

// 真正的 1-2-1:
// 上一行:  .   M   .   M   .
// 中间行:  1   2   2   1   .  
// 下一行:  .   .   .   .   .
// (0,1)和(0,3)是雷，上面一行全部未揭开

const b = new Board(3, 6, 2);
b.mineMap[0][1] = true;
b.mineMap[0][3] = true;

for (let r = 0; r < 3; r++)
  for (let c = 0; c < 6; c++)
    if (!b.mineMap[r][c]) b.numbers[r][c] = b.getMineCount(r, c);

// 只揭开中间行和下一行
for (let c = 0; c < 6; c++) {
  b.state[1][c] = CellState.REVEALED;
  b.state[2][c] = CellState.REVEALED;
}

console.log('棋盘:');
for (let r = 0; r < 3; r++) {
  let line = `R${r}: `;
  for (let c = 0; c < 6; c++) {
    if (b.state[r][c] === CellState.REVEALED) line += ` ${b.numbers[r][c]}  `;
    else if (b.mineMap[r][c]) line += ' M  ';
    else line += ' .  ';
  }
  console.log(line);
}

console.log('\n数字详情:');
for (let c = 0; c < 6; c++) {
  if (b.state[1][c] !== CellState.REVEALED) continue;
  console.log(`  (1,${c}) = ${b.numbers[1][c]}`);
  const neighbors = b.getNeighbors(1, c);
  const hidden = neighbors.filter(([nr,nc]) => b.state[nr][nc] === CellState.HIDDEN);
  const flags = neighbors.filter(([nr,nc]) => b.state[nr][nc] === CellState.FLAGGED);
  const mines = neighbors.filter(([nr,nc]) => b.mineMap[nr][nc]);
  console.log(`    隐藏: ${hidden.map(([r,c])=>`(${r},${c})`).join(',')} (实际含雷: ${mines.map(([r,c])=>`(${r},${c})`).join(',')})`);
  console.log(`    旗子: ${flags.length}`);
}

const r = LogicSolver.analyze(b);
console.log(`\n推理结果:`);
console.log(`  safe: ${r.safe.length}个`, JSON.stringify(r.safe));
console.log(`  mines: ${r.mines.length}个`, JSON.stringify(r.mines));
console.log(`  推理过程: ${r.reasoning.join('; ') || '(无)'}`);

// 解析子集消元
console.log('\n约束分析:');
const sim = { rows: b.rows, cols: b.cols, state: b.state.map(r=>[...r]), numbers: b.numbers, getNeighbors: (r,c)=>b.getNeighbors(r,c) };
const constraints = LogicSolver._collectConstraints(sim);
for (const c of constraints) {
  console.log(`  [${c.r},${c.c}] num=${c.number}, flagged=${c.flagged}, remaining=${c.remainingMines}, hidden=[${c.hiddenCells.join(', ')}]`);
}

// 手工子集消元验证
console.log('\n子集关系检查:');
for (let i = 0; i < constraints.length; i++) {
  for (let j = i+1; j < constraints.length; j++) {
    const ci = constraints[i], cj = constraints[j];
    const setA = new Set(ci.hiddenCells), setB = new Set(cj.hiddenCells);
    
    if (LogicSolver._isSubset(setA, setB) && setA.size < setB.size) {
      const diff = cj.hiddenCells.filter(c => !setA.has(c));
      const md = cj.remainingMines - ci.remainingMines;
      console.log(`  C${i} ⊆ C${j}: diff=[${diff.join(', ')}], mineDiff=${md}`);
      if (md === 0) console.log(`    → ${diff.join(', ')} 安全!`);
      else if (md === diff.length) console.log(`    → ${diff.join(', ')} 是雷!`);
    }
    if (LogicSolver._isSubset(setB, setA) && setB.size < setA.size) {
      const diff = ci.hiddenCells.filter(c => !setB.has(c));
      const md = ci.remainingMines - cj.remainingMines;
      console.log(`  C${j} ⊆ C${i}: diff=[${diff.join(', ')}], mineDiff=${md}`);
      if (md === 0) console.log(`    → ${diff.join(', ')} 安全!`);
      else if (md === diff.length) console.log(`    → ${diff.join(', ')} 是雷!`);
    }
  }
}
