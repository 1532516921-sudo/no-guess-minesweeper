/**
 * 无猜扫雷 - 综合压力测试 v5
 *
 * 目标：在 130 雷模式（30×20=600格）下大规模验证棋盘无猜性。
 * 测试内容：
 *   1. 生成成功率（guaranteedNoGuess = true 比例）
 *   2. 独立步进验证：用与 _verifySolvable 相同的求解过程重跑，
 *      每步检查「被判定为安全」的格子是否真的是安全的，
 *      如果 solver 曾把雷格当作安全格揭开 → 标记 false positive。
 *   3. 多点击位置覆盖（中心 / 四角 / 边中点）
 *
 * 运行方式:   node stress_test_v5.js [每个位置次数]
 *   e.g.       node stress_test_v5.js 30
 */

const { Board, SimBoard, CellState, LogicSolver } = require('../游戏源码/game.js');

// ============================================================
// 配置
// ============================================================
const ROWS = 20;
const COLS = 30;
const MINES = 130;

const args = process.argv.slice(2);
const PER_POSITION = parseInt(args[0]) || 20;

// 测试点击位置
const POSITIONS = [
  { r: 10, c: 15, label: '中心 (10,15)' },
  { r: 0,  c: 0,  label: '左上角 (0,0)' },
  { r: 0,  c: 29, label: '右上角 (0,29)' },
  { r: 19, c: 0,  label: '左下角 (19,0)' },
  { r: 19, c: 29, label: '右下角 (19,29)' },
  { r: 0,  c: 15, label: '上边中点 (0,15)' },
];

// ============================================================
// 统计对象
// ============================================================
const stats = {
  totalAttempts: 0,
  firstMoveMine: 0,
  validAttempts: 0,
  noGuess: 0,
  fallback: 0,
  falsePositive: 0,
  validatedPass: 0,
  timeGenMs: 0,
  timeVerifyMs: 0,
  byPosition: {},
};

for (const pos of POSITIONS) {
  stats.byPosition[pos.label] = { valid: 0, noGuess: 0, fallback: 0, fp: 0, validated: 0 };
}

// ============================================================
// 步进验证器：独立重跑求解，检查每步是否把雷当作安全格
// ============================================================
function verifyBoard(board) {
  const sim = new SimBoard(board);
  let integrityError = null;

  for (let outer = 0; outer < 200; outer++) {
    // === 阶段 A: 反复应用推理规则 ===
    let changed = true;
    while (changed) {
      changed = false;
      const result = LogicSolver._analyze(sim);

      for (const [r, c] of result.safe) {
        if (!sim.isHidden(r, c)) continue;
        // 关键检查：solver 判定安全的格子，必须真的不是雷
        if (board.mineMap[r][c]) {
          integrityError = `阶段A：solver 判定 (${r},${c}) 为安全，但实际是雷！`;
          return { solvable: false, integrityError };
        }
        sim.reveal(r, c);
        if (sim.numbers[r][c] === 0) sim.floodFill(r, c);
        changed = true;
      }
      for (const [r, c] of result.mines) {
        if (sim.isHidden(r, c)) {
          sim.flag(r, c);
          changed = true;
        }
      }
      if (integrityError) break;
    }
    if (integrityError) break;

    // === 检查完成状态 ===
    let hidden = 0, flagged = 0;
    for (let r = 0; r < sim.rows; r++) {
      for (let c = 0; c < sim.cols; c++) {
        if (sim.state[r][c] === CellState.HIDDEN) hidden++;
        else if (sim.state[r][c] === CellState.FLAGGED) flagged++;
      }
    }
    const remainingMines = board.mines - flagged;

    if (hidden === remainingMines) return { solvable: true, integrityError: null };
    if (hidden === 0) {
      // 所有格都揭开/标旗 → 确认所有雷都被标旗
      for (let r = 0; r < board.rows; r++) {
        for (let c = 0; c < board.cols; c++) {
          if (board.mineMap[r][c] && sim.state[r][c] !== CellState.FLAGGED) {
            return { solvable: false, integrityError: '棋盘揭完但仍有雷未被标旗' };
          }
        }
      }
      return { solvable: true, integrityError: null };
    }

    // === 阶段 B: 试探回溯 ===
    const candidate = LogicSolver._pickTrialCell(sim);
    if (!candidate) {
      return {
        solvable: false,
        integrityError: `无候选格：隐藏=${hidden}，剩余雷=${remainingMines}（可能真正需要猜测）`,
      };
    }

    const [tr, tc] = candidate;

    // 分支 1: 假设是雷
    const simMine = new SimBoard(sim);
    simMine.flag(tr, tc);
    const mineConflict = LogicSolver._propagateUntilConflict(simMine);

    // 分支 2: 假设是安全
    const simSafe = new SimBoard(sim);
    simSafe.reveal(tr, tc);
    if (simSafe.numbers[tr][tc] === 0) simSafe.floodFill(tr, tc);
    const safeConflict = LogicSolver._propagateUntilConflict(simSafe);

    if (mineConflict && !safeConflict) {
      // 假设是雷 → 矛盾 → 确定安全
      // 关键检查：被判定安全的格子必须是真安全
      if (board.mineMap[tr][tc]) {
        return {
          solvable: false,
          integrityError: `回溯：mine分支矛盾判定 (${tr},${tc}) 安全，但实际是雷！（safe分支未检测出揭示雷格的矛盾）`,
        };
      }
      sim.reveal(tr, tc);
      if (sim.numbers[tr][tc] === 0) sim.floodFill(tr, tc);
    } else if (safeConflict && !mineConflict) {
      // 假设安全 → 矛盾 → 确定是雷
      sim.flag(tr, tc);
    } else {
      return {
        solvable: false,
        integrityError: `候选 (${tr},${tc}) 两分支自洽（mineConflict=${mineConflict}, safeConflict=${safeConflict}）→ 真正需要猜测`,
      };
    }
  }

  return { solvable: false, integrityError: '达到最大迭代上限' };
}

// ============================================================
// 主测试循环
// ============================================================
const tStartTotal = Date.now();
console.log('=' .repeat(70));
console.log(`  无猜扫雷 综合压力测试 v5`);
console.log(`  棋盘: ${ROWS}×${COLS}=${ROWS * COLS}格, ${MINES}雷 (密度 ${(MINES / (ROWS * COLS) * 100).toFixed(1)}%)`);
console.log(`  位置数: ${POSITIONS.length}, 每位置: ${PER_POSITION} 次`);
console.log('=' .repeat(70));

for (const pos of POSITIONS) {
  const posStats = stats.byPosition[pos.label];

  for (let i = 0; i < PER_POSITION; i++) {
    const tStart = Date.now();
    const board = new Board(ROWS, COLS, MINES);
    const result = board.reveal(pos.r, pos.c);
    const genTime = Date.now() - tStart;
    stats.timeGenMs += genTime;

    stats.totalAttempts++;
    posStats.valid++;

    if (typeof result === 'object' && result.status === 'game_over') {
      stats.firstMoveMine++;
      continue;
    }

    stats.validAttempts++;

    if (board.guaranteedNoGuess) {
      stats.noGuess++;
      posStats.noGuess++;

      const vStart = Date.now();
      const vResult = verifyBoard(board);
      stats.timeVerifyMs += Date.now() - vStart;

      if (vResult.integrityError) {
        stats.falsePositive++;
        posStats.fp++;
        console.log(`\n❌ [${pos.label} #${i}] FALSE POSITIVE 发现！`);
        console.log(`   ${vResult.integrityError}`);
      } else {
        stats.validatedPass++;
        posStats.validated++;
      }
    } else {
      stats.fallback++;
      posStats.fallback++;
    }
  }

  const pct = posStats.valid > 0 ? (posStats.noGuess / posStats.valid * 100).toFixed(1) : 'N/A';
  const fpInfo = posStats.fp > 0 ? ` ❌ FP=${posStats.fp}` : '';
  console.log(`  ${pos.label}: ${posStats.noGuess}/${posStats.valid} 无猜 (${pct}%)${fpInfo}`);
}

const tTotal = Date.now() - tStartTotal;

// ============================================================
// 汇总报告
// ============================================================
console.log('\n' + '=' .repeat(70));
console.log('  汇总报告');
console.log('=' .repeat(70) + '\n');

console.log('── 生成统计 ──');
console.log(`  尝试次数:     ${stats.totalAttempts}`);
console.log(`  首次踩雷:     ${stats.firstMoveMine}（已跳过）`);
console.log(`  有效棋盘:     ${stats.validAttempts}`);
console.log(`  生成用时:     ${stats.timeGenMs}ms（均 ${stats.validAttempts > 0 ? Math.round(stats.timeGenMs / stats.validAttempts) : '-'}ms/次）`);
console.log(`  验证用时:     ${stats.timeVerifyMs}ms`);
console.log(`  总耗时:       ${tTotal}ms\n`);

console.log('── 无猜统计 ──');
const rate = stats.validAttempts > 0 ? (stats.noGuess / stats.validAttempts * 100).toFixed(1) : 'N/A';
console.log(`  guaranteedNoGuess = true:  ${stats.noGuess}/${stats.validAttempts} (${rate}%)`);
console.log(`  guaranteedNoGuess = false: ${stats.fallback}/${stats.validAttempts}\n`);

console.log('── 独立验证结果 ──');
console.log(`  步进验证通过:   ${stats.validatedPass}/${stats.noGuess}`);
console.log(`  FALSE POSITIVE: ${stats.falsePositive}/${stats.noGuess}`);
console.log('  ' + ('=' .repeat(30)));

if (stats.falsePositive === 0 && stats.noGuess > 0) {
  console.log(`\n✅ 结论：130雷模式 (${ROWS}×${COLS}) 所有标记为无猜的棋盘均通过独立验证，无 false positive。`);
} else if (stats.falsePositive > 0) {
  console.log(`\n❌ 结论：发现 ${stats.falsePositive} 个 false positive，_verifySolvable 存在缺陷！`);
} else {
  console.log('\n⚠ 没有产生任何 guaranteedNoGuess=true 的棋盘，请检查生成逻辑。');
}
