const fs = require('fs');
const vm = require('vm');
const path = require('path');
const code = fs.readFileSync(path.join(__dirname, '..', '游戏源码', 'game.js'), 'utf8');
const script = new vm.Script(code);
const context = vm.createContext({ module: { exports: {} }, require });
script.runInContext(context);
const { Board, CellState, LogicSolver } = context.module.exports;

console.log('===== 验证真实 1-2-1 模式 =====\n');

// 正确构造：中间行数字为 1,2,2,1，两个雷都在上面
const b = new Board(3, 5, 2);
b.mineMap[0][1] = true;
b.mineMap[0][3] = true;  // 雷在(0,1)和(0,3)

for (let r = 0; r < 3; r++)
  for (let c = 0; c < 5; c++)
    if (!b.mineMap[r][c]) b.numbers[r][c] = b.getMineCount(r, c);

// 揭开中间行所有格子和它相邻的下方
for (let c = 0; c < 5; c++) {
  b.state[1][c] = CellState.REVEALED;
}

// 同时解开下面一行所有（这样中间的数字就暴露完整邻居）
for (let c = 0; c < 5; c++) {
  b.state[2][c] = CellState.REVEALED;
}

console.log('棋盘 (R=行, M=雷, .=未揭开, 数字=已揭开):');
for (let r = 0; r < 3; r++) {
  let line = `R${r}: `;
  for (let c = 0; c < 5; c++) {
    if (b.state[r][c] === CellState.REVEALED) line += ` ${b.numbers[r][c]}  `;
    else if (b.mineMap[r][c]) line += ' M  ';
    else line += ' .  ';
  }
  console.log(line);
}

console.log('\n中间行数字详情:');
for (let c = 0; c < 5; c++) {
  console.log(`  (1,${c}) = ${b.numbers[1][c]}`);
  const neighbors = b.getNeighbors(1, c);
  const hidden = neighbors.filter(([nr,nc]) => b.state[nr][nc] === CellState.HIDDEN);
  const mines = neighbors.filter(([nr,nc]) => b.mineMap[nr][nc]);
  console.log(`    邻居: ${neighbors.map(([r,c])=>`(${r},${c})`).join(',')}`);
  console.log(`    隐藏: ${hidden.map(([r,c])=>`(${r},${c})`).join(',')}`);
  console.log(`    含雷: ${mines.map(([r,c])=>`(${r},${c})`).join(',')}`);
}

const r = LogicSolver.analyze(b);
console.log(`\n推理结果:`);
console.log(`  safe: ${r.safe.length}个`, JSON.stringify(r.safe));
console.log(`  mines: ${r.mines.length}个`, JSON.stringify(r.mines));
console.log(`  推理: ${r.reasoning.join('; ')}`);
