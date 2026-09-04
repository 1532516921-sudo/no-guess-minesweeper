const fs = require('fs');
const vm = require('vm');
const path = require('path');
const code = fs.readFileSync(path.join(__dirname, '..', '游戏源码', 'game.js'), 'utf8');
const script = new vm.Script(code);
const context = vm.createContext({ module: { exports: {} }, require });
script.runInContext(context);
const { Board, CellState, LogicSolver } = context.module.exports;

// ===== 调试测试2 =====
console.log('===== 调试测试2 =====');
const b = new Board(3, 3, 1);
b.mineMap[0][0] = true;
for (let r = 0; r < 3; r++)
  for (let c = 0; c < 3; c++)
    if (!b.mineMap[r][c]) b.numbers[r][c] = b.getMineCount(r, c);

b.state[1][1] = CellState.REVEALED;

console.log('棋盘状态:');
for (let r = 0; r < 3; r++) {
  let line = '';
  for (let c = 0; c < 3; c++) {
    const s = b.state[r][c];
    const n = b.numbers[r][c];
    const m = b.mineMap[r][c];
    line += `[${s},${n},${m ? 'M':'.'}] `;
  }
  console.log(line);
}

console.log('\n中心(1,1)邻居:');
for (const [nr, nc] of b.getNeighbors(1, 1)) {
  console.log(`  (${nr},${nc}): state=${b.state[nr][nc]}, num=${b.numbers[nr][nc]}, mine=${b.mineMap[nr][nc]}`);
}

// 手动调用 _analyze
const sim = {
  rows: b.rows, cols: b.cols,
  state: b.state.map(row => [...row]),
  numbers: b.numbers,
  mineMap: b.mineMap,
  getNeighbors: (r, c) => b.getNeighbors(r, c),
};
const result = LogicSolver._analyze(sim);
console.log('\n_analyze结果:');
console.log('safe:', JSON.stringify(result.safe));
console.log('mines:', JSON.stringify(result.mines));

// 看看analyze内部的循环
console.log('\n手动检查数字约束:');
for (let r = 0; r < sim.rows; r++) {
  for (let c = 0; c < sim.cols; c++) {
    if (sim.state[r][c] === CellState.REVEALED && sim.numbers[r][c] > 0) {
      console.log(`  检查揭示格子(${r},${c}) num=${sim.numbers[r][c]}`);
      const neighbors = sim.getNeighbors(r, c);
      const hidden = [];
      let flagged = 0;
      for (const [nr, nc] of neighbors) {
        console.log(`    邻居(${nr},${nc}) state=${sim.state[nr][nc]}`);
        if (sim.state[nr][nc] === CellState.FLAGGED) flagged++;
        else if (sim.state[nr][nc] === CellState.HIDDEN || sim.state[nr][nc] === CellState.QUESTION) {
          hidden.push([nr, nc]);
        }
      }
      console.log(`  flagged=${flagged}, hidden=${hidden.length} hidden=`, JSON.stringify(hidden));
      
      const num = sim.numbers[r][c];
      if (flagged === num && hidden.length > 0) {
        console.log(`  → 规则A: 全安全`);
      }
      const remainingMines = num - flagged;
      if (remainingMines > 0 && hidden.length === remainingMines) {
        console.log(`  → 规则B: 全雷`);
      }
    }
  }
}
