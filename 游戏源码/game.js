/**
 * 无猜扫雷 - 核心游戏逻辑 v2.2
 * 
 * 核心设计：
 * 1. 使用「约束求解 + 迭代传播」生成唯一解谜题
 * 2. 每步都可通过逻辑推理确定，永不猜测
 * 3. 推理引擎支持基础数字约束 + 子集消元 + 双重计数消元
 * 4. 谜题验证使用与玩家相同的推理方式，保证一致性
 * 
 * 版本历史：
 * v2.2 - 新增 deepAnalyze() 方法供提示系统使用，含试探回溯推理
 * v2.1 - 修复 _propagateUntilConflict 矛盾检测（纯约束检查替代 mineMap 检查）
 *        修复 _hasConstraintViolation 全局旗子数检查
 *        添加 guaranteedNoGuess 标记
 * v2.0 - 初始逻辑求解器版本
 */

// ============================================================
// 基础类型与常量
// ============================================================

/** 格子状态：仅保留三种核心状态，移除无用的 QUESTION */
const CellState = Object.freeze({
  HIDDEN: 0,
  REVEALED: 1,
  FLAGGED: 2,
});

// 数字在格子中的颜色索引
const NUMBER_COLORS = {
  1: '#60a5fa',
  2: '#34d399',
  3: '#f87171',
  4: '#818cf8',
  5: '#fbbf24',
  6: '#2dd4bf',
  7: '#1e293b',
  8: '#94a3b8',
};

/** 扫雷棋盘核心类 */
class Board {
  constructor(rows, cols, mines) {
    if (!Number.isInteger(rows) || rows < 1 || rows > 100) throw new Error('rows must be 1-100');
    if (!Number.isInteger(cols) || cols < 1 || cols > 100) throw new Error('cols must be 1-100');
    if (!Number.isInteger(mines) || mines < 0 || mines >= rows * cols) throw new Error('invalid mine count');

    this.rows = rows;
    this.cols = cols;
    this.mines = mines;
    this.totalCells = rows * cols;

    this.mineMap = Array.from({ length: rows }, () => Array(cols).fill(false));
    this.numbers = Array.from({ length: rows }, () => Array(cols).fill(-1));
    this.state = Array.from({ length: rows }, () => Array(cols).fill(CellState.HIDDEN));

    this.gameOver = false;
    this.won = false;
    this.firstMove = true;
    this.initialized = false;

    // 记录踩雷位置，用于诊断面板
    this.lastMineHit = null;

    // ISSUE-001/009: 标记该棋盘是否通过了完整的无猜验证
    this.guaranteedNoGuess = false;
  }

  inBounds(r, c) {
    return Number.isInteger(r) && Number.isInteger(c) && r >= 0 && r < this.rows && c >= 0 && c < this.cols;
  }

  getNeighbors(r, c) {
    const neighbors = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr, nc = c + dc;
        if (this.inBounds(nr, nc)) neighbors.push([nr, nc]);
      }
    }
    return neighbors;
  }

  /** 计算某个格子的邻居地雷数 */
  getMineCount(r, c) {
    let count = 0;
    for (const [nr, nc] of this.getNeighbors(r, c)) {
      if (this.mineMap[nr][nc]) count++;
    }
    return count;
  }

  /** 获取某个格子的邻居中 FLAGGED 和 HIDDEN 的数量 */
  getNeighborCounts(r, c) {
    const neighbors = this.getNeighbors(r, c);
    let flagged = 0;
    const hidden = [];
    for (const [nr, nc] of neighbors) {
      const s = this.state[nr][nc];
      if (s === CellState.FLAGGED) flagged++;
      else if (s === CellState.HIDDEN) hidden.push([nr, nc]);
    }
    return { flagged, hidden };
  }

  /** 核心：揭开格子。返回值: { status: string, mineHit?: [number, number] } */
  reveal(r, c) {
    if (this.gameOver || this.won) return { status: 'game_over' };
    if (this.state[r][c] !== CellState.HIDDEN) return { status: 'invalid' };

    if (this.firstMove) {
      this._initMines(r, c);
      this.firstMove = false;
      this.initialized = true;
    }

    this._revealCell(r, c);
    this._checkWin();
    if (this.gameOver) {
      return { status: 'mine_hit', mineHit: this.lastMineHit ?? [r, c] };
    }
    return { status: this.won ? 'won' : 'ok' };
  }

  /** 切换标记：无 ↔ 🚩 */
  toggleFlag(r, c) {
    if (this.gameOver || this.won) return;
    if (this.state[r][c] === CellState.HIDDEN) {
      this.state[r][c] = CellState.FLAGGED;
    } else if (this.state[r][c] === CellState.FLAGGED) {
      this.state[r][c] = CellState.HIDDEN;
    }
  }

  /** （已废弃）cycleFlag 旧接口，保留兼容 */
  cycleFlag(r, c) {
    this.toggleFlag(r, c);
  }

  /** Chord 操作：双击已揭开的数字，快速揭开周围 */
  chord(r, c) {
    if (this.state[r][c] !== CellState.REVEALED) return 'invalid';
    const num = this.numbers[r][c];
    if (num <= 0) return 'invalid';

    const { flagged, hidden } = this.getNeighborCounts(r, c);
    if (flagged !== num) return 'flag_mismatch';

    if (this.firstMove) return 'invalid';
    if (this.gameOver || this.won) return 'game_over';

    let hitMine = false;
    for (const [nr, nc] of hidden) {
      if (this.mineMap[nr][nc]) hitMine = true;
      this._revealCell(nr, nc);
    }

    if (hitMine) this.gameOver = true;
    this._checkWin();
    return hitMine ? 'mine_hit' : (this.won ? 'won' : 'ok');
  }

  // ============================================================
  // 内部方法
  // ============================================================

  _revealCell(r, c) {
    if (!this.inBounds(r, c)) return;
    if (this.state[r][c] !== CellState.HIDDEN) return;

    this.state[r][c] = CellState.REVEALED;

    if (this.mineMap[r][c]) {
      this.lastMineHit = [r, c];
      this.gameOver = true;
      return;
    }

    if (this.numbers[r][c] === 0) {
      this._floodFill(r, c);
    }
  }

  /** BFS 洪水填充空白区域 */
  _floodFill(r, c) {
    const queue = [[r, c]];
    const visited = new Set();
    visited.add(`${r},${c}`);

    while (queue.length > 0) {
      const [cr, cc] = queue.shift();
      for (const [nr, nc] of this.getNeighbors(cr, cc)) {
        const key = `${nr},${nc}`;
        if (visited.has(key)) continue;
        if (this.state[nr][nc] === CellState.HIDDEN) {
          this.state[nr][nc] = CellState.REVEALED;
          visited.add(key);
          if (this.numbers[nr][nc] === 0) {
            queue.push([nr, nc]);
          }
        }
      }
    }
  }

  /**
   * 检查胜利条件：所有非雷格子必须已揭开。
   * 原来的逻辑（hiddenCount === mines）在玩家标旗后失效，
   * 因为标旗的格子不算 HIDDEN 了。
   * 修正为：直接遍历所有非雷格子，确认全部已 REVEALED。
   */
  _checkWin() {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (!this.mineMap[r][c] && this.state[r][c] !== CellState.REVEALED) {
          return; // 还有非雷格子没揭开，未胜利
        }
      }
    }
    // 所有非雷格都已揭开 → 胜利
    this.won = true;
    // 自动标旗所有未标记的地雷（已标旗的保持不变）
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.mineMap[r][c] && this.state[r][c] !== CellState.FLAGGED) {
          this.state[r][c] = CellState.FLAGGED;
        }
      }
    }
  }

  // ============================================================
  // 逻辑谜题生成
  // ============================================================

  _initMines(firstR, firstC) {
    // ISSUE-006: 超大棋盘同步验证会冻结浏览器（实测 100x100/2000 曾达 117s）。
    // ① 按棋盘规模降低尝试次数；② 设置验证时间预算，超时即走 fallback（保证有棋盘可玩）。
    // 常规尺寸（≤ 40x40）不受影响，仍可稳定产出无猜棋盘。
    const totalCells = this.totalCells;
    const maxAttempts = totalCells > 8000 ? 30 : (totalCells > 2500 ? 60 : 300);
    // 大棋盘（30×20=600格）需要更多预算做试探回溯验证
    const verifyBudgetMs = totalCells > 4000 ? 600 : (totalCells > 1600 ? 5000 : 2000);
    const tStart = Date.now();

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // 验证总耗时超出预算 → 停止尝试，直接走 fallback（时间盒保护主线程）
      if (Date.now() - tStart > verifyBudgetMs) break;

      this._resetState();

      this._placeMinesWithSafeZone(firstR, firstC);

      // 计算所有数字
      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) {
          if (!this.mineMap[r][c]) {
            this.numbers[r][c] = this.getMineCount(r, c);
          }
        }
      }

      // 模拟第一次点击展开
      this.state[firstR][firstC] = CellState.REVEALED;
      if (this.numbers[firstR][firstC] === 0) {
        this._floodFill(firstR, firstC);
      }

      if (this._verifySolvable()) {
        // 找到可解谜题，重置状态为第一次点击后的局面
        this.state = Array.from({ length: this.rows }, () => Array(this.cols).fill(CellState.HIDDEN));
        this.state[firstR][firstC] = CellState.REVEALED;
        if (this.numbers[firstR][firstC] === 0) {
          this._floodFill(firstR, firstC);
        }
        this.guaranteedNoGuess = true;
        return;
      }
    }

    // ISSUE-001 fix: fallback 时重置地雷布局保证安全区，放弃完全验证
    // 但仍然保证第一次点击安全（安全区保证）
    this._resetState();
    this._placeMinesWithSafeZone(firstR, firstC);
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (!this.mineMap[r][c]) {
          this.numbers[r][c] = this.getMineCount(r, c);
        }
      }
    }
    this.state[firstR][firstC] = CellState.REVEALED;
    if (this.numbers[firstR][firstC] === 0) {
      this._floodFill(firstR, firstC);
    }
    this.guaranteedNoGuess = false;
  }

  _resetState() {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        this.mineMap[r][c] = false;
        this.numbers[r][c] = -1;
        this.state[r][c] = CellState.HIDDEN;
      }
    }
  }

  /**
   * 验证谜题是否可通过纯逻辑推理完全解开。
   * 使用与 LogicSolver 完全相同的推理循环。
   * 
   * 推理策略：
   * 1. 反复应用推理引擎（_analyze）直到卡住
   * 2. 卡住后选一个隐藏格做「试探回溯」：
   *    - 假设它是雷 → 传播 → 若矛盾 → 确定安全
   *    - 假设它安全 → 传播 → 若矛盾 → 确定是雷
   *    - 两分支都自洽 → 真正需要猜测 → 不可解
   * 3. 迭代直到全部揭开
   */
  _verifySolvable() {
    const sim = new SimBoard(this);

    const maxOuter = Math.min(this.totalCells, 200);

    for (let outer = 0; outer < maxOuter; outer++) {
      // === 阶段 A: 推理引擎迭代推进 ===
      let changed = true;
      while (changed) {
        changed = false;
        const result = LogicSolver._analyze(sim);

        for (const [r, c] of result.safe) {
          if (sim.isHidden(r, c)) {
            sim.reveal(r, c);
            if (sim.numbers[r][c] === 0) sim.floodFill(r, c);
            changed = true;
          }
        }
        for (const [r, c] of result.mines) {
          if (sim.isHidden(r, c)) {
            sim.flag(r, c);
            changed = true;
          }
        }
      }

      // 检查是否所有非雷格都揭开了
      let allRevealed = true;
      for (let r = 0; r < this.rows && allRevealed; r++) {
        for (let c = 0; c < this.cols && allRevealed; c++) {
          if (!this.mineMap[r][c] && sim.state[r][c] !== CellState.REVEALED) {
            allRevealed = false;
          }
        }
      }
      if (allRevealed) return true;

      // === 阶段 B: 试探回溯 ===
      const candidate = LogicSolver._pickTrialCell(sim);
      if (!candidate) return false;

      const [tr, tc] = candidate;

      // 分支 1: 假设是雷 → 传播
      const simMine = new SimBoard(sim);
      simMine.flag(tr, tc);
      const mineConflict = LogicSolver._propagateUntilConflict(simMine);

      // 分支 2: 假设是安全 → 传播
      const simSafe = new SimBoard(sim);
      simSafe.reveal(tr, tc);
      if (simSafe.numbers[tr][tc] === 0) simSafe.floodFill(tr, tc);
      const safeConflict = LogicSolver._propagateUntilConflict(simSafe);

      if (mineConflict && !safeConflict) {
        // 假设是雷 → 矛盾 → 确定安全
        sim.reveal(tr, tc);
        if (sim.numbers[tr][tc] === 0) sim.floodFill(tr, tc);
        continue;
      }
      if (safeConflict && !mineConflict) {
        // 假设安全 → 矛盾 → 确定是雷
        sim.flag(tr, tc);
        continue;
      }
      // 两分支都自洽 → 真正需要猜测
      return false;
    }

    return false;
  }

  _placeMinesWithSafeZone(firstR, firstC) {
    const safeZone = new Set();
    const addZone = (r, c, depth) => {
      safeZone.add(`${r},${c}`);
      if (depth <= 0) return;
      for (const [nr, nc] of this.getNeighbors(r, c)) {
        addZone(nr, nc, depth - 1);
      }
    };
    // 2层安全区：第一点击 + 邻居 + 邻居的邻居（让第一次点击展开成大片区域）
    addZone(firstR, firstC, 2);

    const candidates = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (!safeZone.has(`${r},${c}`)) {
          candidates.push([r, c]);
        }
      }
    }

    // 安全区降级
    let attempt = 0;
    while (candidates.length < this.mines && attempt < 3) {
      // 缩小安全区：减少 depth
      safeZone.clear();
      const depth = [1, 0][attempt] ?? 0;
      const add = (r, c, d) => {
        safeZone.add(`${r},${c}`);
        if (d <= 0) return;
        for (const [nr, nc] of this.getNeighbors(r, c)) add(nr, nc, d - 1);
      };
      add(firstR, firstC, depth);

      candidates.length = 0;
      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) {
          if (!safeZone.has(`${r},${c}`)) candidates.push([r, c]);
        }
      }
      attempt++;
    }

    shuffleArray(candidates);
    const actualMines = Math.min(this.mines, candidates.length);
    for (let i = 0; i < actualMines; i++) {
      const [mr, mc] = candidates[i];
      this.mineMap[mr][mc] = true;
    }
  }

  /** 创建当前局面的快照（供诊断和提示使用） */
  snapshot() {
    return {
      rows: this.rows,
      cols: this.cols,
      state: this.state.map(row => [...row]),
      numbers: this.numbers.map(row => [...row]),
      mineMap: this.mineMap.map(row => [...row]),
      mines: this.mines,
      flagged: this.flaggedCount(),
      hiddenSafe: this.totalCells - this.mines - this.revealedCount(),
      mineHit: this.lastMineHit,
    };
  }

  flaggedCount() {
    let c = 0;
    for (let r = 0; r < this.rows; r++)
      for (let cc = 0; cc < this.cols; cc++)
        if (this.state[r][cc] === CellState.FLAGGED) c++;
    return c;
  }

  revealedCount() {
    let c = 0;
    for (let r = 0; r < this.rows; r++)
      for (let cc = 0; cc < this.cols; cc++)
        if (this.state[r][cc] === CellState.REVEALED) c++;
    return c;
  }
}

/**
 * 模拟棋盘 —— 用于谜题验证和推理引擎的内部数据结构。
 * 和真实 Board 行为完全一致，但独立于 UI 状态。
 */
class SimBoard {
  constructor(board) {
    this.rows = board.rows;
    this.cols = board.cols;
    // ISSUE-004 fix: 深拷贝 mineMap 和 numbers，防止意外写穿透
    this.mineMap = board.mineMap.map(row => [...row]);
    this.numbers = board.numbers.map(row => [...row]);
    this.state = board.state.map(row => [...row]);
    this._neighborCache = new Map();
  }

  getNeighbors(r, c) {
    const key = `${r},${c}`;
    let n = this._neighborCache.get(key);
    if (n) return n;
    n = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < this.rows && nc >= 0 && nc < this.cols) n.push([nr, nc]);
      }
    }
    this._neighborCache.set(key, n);
    return n;
  }

  isHidden(r, c) {
    return this.state[r][c] === CellState.HIDDEN;
  }

  reveal(r, c) {
    this.state[r][c] = CellState.REVEALED;
  }

  flag(r, c) {
    this.state[r][c] = CellState.FLAGGED;
  }

  floodFill(r, c) {
    const queue = [[r, c]];
    const visited = new Set();
    visited.add(`${r},${c}`);

    while (queue.length > 0) {
      const [cr, cc] = queue.shift();
      for (const [nr, nc] of this.getNeighbors(cr, cc)) {
        const key = `${nr},${nc}`;
        if (visited.has(key)) continue;
        if (this.isHidden(nr, nc)) {
          this.state[nr][nc] = CellState.REVEALED;
          visited.add(key);
          if (this.numbers[nr][nc] === 0) {
            queue.push([nr, nc]);
          }
        }
      }
    }
  }
}

/** Fisher-Yates 洗牌 */
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// ============================================================
// 逻辑推理引擎 v2
// ============================================================

/**
 * 推理引擎返回的结果
 * @typedef {Object} InferenceResult
 * @property {[number,number][]} safe - 可以安全揭开的格子坐标
 * @property {[number,number][]} mines - 可以确定标雷的格子坐标
 * @property {string[]} reasoning - 推理步骤的人类可读描述
 */

class LogicSolver {
  /**
   * 分析棋盘，返回所有可确定的逻辑操作。
   * @param {Board} board
   * @returns {InferenceResult}
   */
  static analyze(board) {
    const sim = new SimBoard(board);
    return LogicSolver._analyze(sim);
  }

  /**
   * 分析 SimBoard，返回所有可确定的逻辑操作。
   * 推理策略（按优先级）：
   * 1. 基础数字约束（规则 A/B）
   * 2. 双重计数消元（"如果这个数是雷则矛盾"）
   * 3. 子集约束消元（pairwise 推理）
   * 4. 迭代直到稳定
   * 
   * 注意：不依赖 mineMap，只使用 state + numbers 推理。
   */
  static _analyze(sim) {
    const safe = new Set();
    const mines = new Set();
    const reasoning = [];

    // 收集所有已揭示的数字格子的约束
    const constraints = LogicSolver._collectConstraints(sim);

    // === 阶段 1: 基础数字约束 ===
    for (const c of constraints) {
      if (c.flagged === c.number && c.hiddenCells.length > 0) {
        // 规则 A: 已标雷数 == 数字 → 其余全部安全
        for (const cell of c.hiddenCells) {
          safe.add(cell);
        }
        reasoning.push(`数字 ${c.number} 在 (${c.r},${c.c}) 周围 ${c.flagged} 个旗子已标满 → 其余 ${c.hiddenCells.length} 格安全`);
      }

      const remaining = c.number - c.flagged;
      if (remaining > 0 && c.hiddenCells.length === remaining) {
        // 规则 B: 未揭开格数 == 还需标雷数 → 全是雷
        for (const cell of c.hiddenCells) {
          mines.add(cell);
        }
        reasoning.push(`数字 ${c.number} 在 (${c.r},${c.c}) 周围 ${c.hiddenCells.length} 格必须全为地雷`);
      }
    }

    // === 阶段 2: 双重计数消元（"如果安全/是雷则矛盾"）===
    // 对每个隐藏格子，检查它如果安全（或如果它是雷）是否与其他约束矛盾
    // 这可以捕获 "1-2-1 模式" 等经典扫雷模式
    const hiddenCells = new Set();
    for (const c of constraints) {
      for (const cell of c.hiddenCells) {
        hiddenCells.add(cell);
      }
    }

    for (const cell of hiddenCells) {
      if (safe.has(cell) || mines.has(cell)) continue;

      // 假设这个格子是安全的 → 检查是否导致矛盾
      const [cr, cc] = cell.split(',').map(Number);
      const assumeSafe = LogicSolver._checkAssumption(sim, constraints, cell, false);
      const assumeMine = LogicSolver._checkAssumption(sim, constraints, cell, true);

      if (assumeSafe.conflict && !assumeMine.conflict) {
        mines.add(cell);
        reasoning.push(`双重消元：若 (${cr},${cc}) 非雷则矛盾 → 确定是地雷`);
      } else if (assumeMine.conflict && !assumeSafe.conflict) {
        safe.add(cell);
        reasoning.push(`双重消元：若 (${cr},${cc}) 是雷则矛盾 → 确定为安全`);
      }
    }

    // === 阶段 3: 子集约束消元 ===
    // 对每对约束，检查子集关系
    for (let i = 0; i < constraints.length; i++) {
      for (let j = i + 1; j < constraints.length; j++) {
        const ci = constraints[i];
        const cj = constraints[j];

        const setA = new Set(ci.hiddenCells);
        const setB = new Set(cj.hiddenCells);

        // 跳过没有隐藏格子的约束
        if (setA.size === 0 || setB.size === 0) continue;

        // 检查 A ⊆ B
        if (setA.size <= setB.size && LogicSolver._isSubset(setA, setB)) {
          const diff = cj.hiddenCells.filter(c => !setA.has(c));
          if (diff.length === 0) continue;

          const mineDiff = (cj.number - cj.flagged) - (ci.number - ci.flagged);

          if (mineDiff === 0) {
            // B\A 全安全
            for (const d of diff) {
              if (!mines.has(d)) safe.add(d);
            }
            // reasoning.push(`子集消元：${ci.hiddenCells.length}格约束 ⊆ ${cj.hiddenCells.length}格约束，mineDiff=0 → ${diff.length}格安全`);
          } else if (mineDiff === diff.length) {
            // B\A 全是雷
            for (const d of diff) {
              if (!safe.has(d)) mines.add(d);
            }
            // reasoning.push(`子集消元：${ci.hiddenCells.length}格约束 ⊆ ${cj.hiddenCells.length}格约束，mineDiff=${mineDiff} → ${diff.length}格是雷`);
          }
        }

        // 检查 B ⊆ A
        if (setB.size <= setA.size && LogicSolver._isSubset(setB, setA)) {
          const diff = ci.hiddenCells.filter(c => !setB.has(c));
          if (diff.length === 0) continue;

          const mineDiff = (ci.number - ci.flagged) - (cj.number - cj.flagged);

          if (mineDiff === 0) {
            for (const d of diff) {
              if (!mines.has(d)) safe.add(d);
            }
          } else if (mineDiff === diff.length) {
            for (const d of diff) {
              if (!safe.has(d)) mines.add(d);
            }
          }
        }
      }
    }

    return {
      safe: [...safe].map(s => s.split(',').map(Number)),
      mines: [...mines].map(s => s.split(',').map(Number)),
      reasoning,
    };
  }

  /**
   * 收集所有已揭示数字格子的约束
   */
  static _collectConstraints(sim) {
    const constraints = [];
    for (let r = 0; r < sim.rows; r++) {
      for (let c = 0; c < sim.cols; c++) {
        if (sim.state[r][c] !== CellState.REVEALED) continue;
        if (sim.numbers[r][c] <= 0) continue;

        const neighbors = sim.getNeighbors(r, c);
        const hiddenCells = [];
        let flagged = 0;

        for (const [nr, nc] of neighbors) {
          const s = sim.state[nr][nc];
          if (s === CellState.FLAGGED) flagged++;
          else if (s === CellState.HIDDEN) {
            hiddenCells.push(`${nr},${nc}`);
          }
        }

        if (hiddenCells.length > 0) {
          constraints.push({
            r, c,
            number: sim.numbers[r][c],
            flagged,
            hiddenCells,
            hiddenCount: hiddenCells.length,
            remainingMines: sim.numbers[r][c] - flagged,
          });
        }
      }
    }
    return constraints;
  }

  /**
   * 检查某个格子假设为安全/雷时是否与其他约束矛盾。
   * @param {SimBoard} sim
   * @param {Array} constraints
   * @param {string} cell - "r,c" 格式
   * @param {boolean} assumeMine - true表示为雷，false表示安全
   * @returns {{ conflict: boolean }}
   */
  static _checkAssumption(sim, constraints, cell, assumeMine) {
    const [cr, cc] = cell.split(',').map(Number);

    for (const c of constraints) {
      // 只考虑与这个格子相邻的约束
      if (!c.hiddenCells.includes(cell)) continue;

      // 假设这个格子是雷
      if (assumeMine) {
        // 如果所有隐藏格都标雷还不够数字 → 矛盾
        if (c.flagged + 1 > c.number) return { conflict: true };
      } else {
        // 假设这个格子安全
        // 如果剩余隐藏格（除cell外）全标雷也不够数字 → 矛盾
        // 即 tagged + (hiddenCount - 1) < number
        if (c.flagged + (c.hiddenCount - 1) < c.number) return { conflict: true };
      }
    }

    return { conflict: false };
  }

  /** 检查 setA 是否是 setB 的子集 */
  static _isSubset(setA, setB) {
    if (setA.size > setB.size) return false;
    for (const item of setA) {
      if (!setB.has(item)) return false;
    }
    return true;
  }

  /** 检查当前局面是否有任何可确定的操作 */
  static hasLogicalMove(board) {
    const result = LogicSolver.analyze(board);
    return result.safe.length > 0 || result.mines.length > 0;
  }

  /**
   * 对当前棋盘进行深度推理，当基础规则卡住时自动进入试探回溯。
   * 返回和 analyze 相同的结构，但包含回溯推导的结果。
   * @param {Board|SimBoard} boardOrSim
   * @returns {InferenceResult}
   */
  static deepAnalyze(boardOrSim) {
    const sim = boardOrSim instanceof SimBoard ? boardOrSim : new SimBoard(boardOrSim);
    const allSafe = new Set();
    const allMines = new Set();
    const allReasoning = [];

    // === 阶段 A: 反复应用基础规则直到卡住 ===
    const maxIter = 100;
    for (let iter = 0; iter < maxIter; iter++) {
      const result = LogicSolver._analyze(sim);
      if (result.safe.length === 0 && result.mines.length === 0) break;

      for (const [r, c] of result.safe) {
        if (sim.isHidden(r, c)) {
          allSafe.add(`${r},${c}`);
          sim.reveal(r, c);
          if (sim.numbers[r][c] === 0) sim.floodFill(r, c);
        }
      }
      for (const [r, c] of result.mines) {
        if (sim.isHidden(r, c)) {
          allMines.add(`${r},${c}`);
          sim.flag(r, c);
        }
      }
      allReasoning.push(...result.reasoning);
    }

    // === 阶段 B: 试探回溯（当基础规则卡住时） ===
    let backtrackUsed = false;

    // 检查是否已完成
    let hiddenTotal = 0, flagged = 0;
    for (let r = 0; r < sim.rows; r++) {
      for (let c = 0; c < sim.cols; c++) {
        if (sim.state[r][c] === CellState.HIDDEN) hiddenTotal++;
        else if (sim.state[r][c] === CellState.FLAGGED) flagged++;
      }
    }
    if (hiddenTotal > 0) {
      const candidate = LogicSolver._pickTrialCell(sim);
      if (candidate) {
        const [tr, tc] = candidate;

        const simMine = new SimBoard(sim);
        simMine.flag(tr, tc);
        const mineConflict = LogicSolver._propagateUntilConflict(simMine);

        const simSafe = new SimBoard(sim);
        simSafe.reveal(tr, tc);
        if (simSafe.numbers[tr][tc] === 0) simSafe.floodFill(tr, tc);
        const safeConflict = LogicSolver._propagateUntilConflict(simSafe);

        if (mineConflict && !safeConflict) {
          // 假设雷矛盾 → 确定安全
          allSafe.add(`${tr},${tc}`);
          allReasoning.push(`试探回溯：假设 (${tr},${tc}) 是雷导致矛盾 → 确定该格安全`);
          backtrackUsed = true;
        } else if (safeConflict && !mineConflict) {
          // 假设安全矛盾 → 确定是雷
          allMines.add(`${tr},${tc}`);
          allReasoning.push(`试探回溯：假设 (${tr},${tc}) 安全导致矛盾 → 确定该格是地雷`);
          backtrackUsed = true;
        } else {
          allReasoning.push(`试探回溯：候选 (${tr},${tc}) 两分支自洽（mineConflict=${mineConflict}, safeConflict=${safeConflict}），无法确定`);
        }
      }
    }

    return {
      safe: [...allSafe].map(s => s.split(',').map(Number)),
      mines: [...allMines].map(s => s.split(',').map(Number)),
      reasoning: allReasoning,
      backtrackUsed,
    };
  }

  /**
   * 选一个试探候选格。
   * 规则：找参与约束最多的隐藏格（最有信息价值），
   * 如果所有隐藏格都不参与任何约束 → 返回 null（真正需要猜）。
   */
  static _pickTrialCell(sim) {
    const constraints = LogicSolver._collectConstraints(sim);
    if (constraints.length === 0) return null;

    // 统计每个隐藏格出现在几个约束中
    const freq = {};
    for (const c of constraints) {
      for (const cell of c.hiddenCells) {
        freq[cell] = (freq[cell] || 0) + 1;
      }
    }

    const entries = Object.entries(freq);
    if (entries.length === 0) return null;

    // 选出现次数最多的
    entries.sort((a, b) => b[1] - a[1]);
    return entries[0][0].split(',').map(Number);
  }

  /**
   * 对当前 SimBoard 反复应用推理引擎直到无法推进或发现矛盾。
   * 矛盾检测使用纯约束违反（不依赖 mineMap）：
   *   1. 旗子数 > 数字 → 矛盾
   *   2. 旗子数 + 所有隐藏格全标雷 < 数字 → 矛盾
   *   3. 任意格子同时被 safe 和 mines 推导 → 矛盾
   * @param {SimBoard} sim
   * @returns {boolean} true = 发现矛盾，false = 收敛无矛盾
   */
  static _propagateUntilConflict(sim) {
    const maxIter = Math.min(sim.rows * sim.cols, 100);
    for (let iter = 0; iter < maxIter; iter++) {
      // 先检查当前状态是否有约束违反
      if (LogicSolver._hasConstraintViolation(sim)) return true;

      const result = LogicSolver._analyze(sim);

      if (result.safe.length === 0 && result.mines.length === 0) {
        // 卡住了，且无约束违反 → 收敛
        return false;
      }

      // 检查: 同一个格子同时出现在 safe 和 mines 中 → conflict
      const safeSet = new Set(result.safe.map(([r,c]) => `${r},${c}`));
      for (const [mr, mc] of result.mines) {
        if (safeSet.has(`${mr},${mc}`)) return true;
      }

      // 应用推导结果
      for (const [r, c] of result.safe) {
        if (sim.isHidden(r, c)) {
          sim.reveal(r, c);
          if (sim.numbers[r][c] === 0) sim.floodFill(r, c);
        }
      }
      for (const [r, c] of result.mines) {
        if (sim.isHidden(r, c)) sim.flag(r, c);
      }
    }
    return false;
  }

  /**
   * 检查当前 SimBoard 是否有纯约束违反（不依赖 mineMap）。
   * 规则：对每个已揭数字格，检查周围旗子数是否与数字矛盾。
   */
  static _hasConstraintViolation(sim) {
    // 全局检测：总旗子数不能超过总雷数
    let totalFlags = 0;
    let totalMines = 0;
    for (let r = 0; r < sim.rows; r++) {
      for (let c = 0; c < sim.cols; c++) {
        if (sim.state[r][c] === CellState.FLAGGED) totalFlags++;
        if (sim.mineMap[r][c]) totalMines++;
      }
    }
    if (totalFlags > totalMines) return true;

    for (let r = 0; r < sim.rows; r++) {
      for (let c = 0; c < sim.cols; c++) {
        if (sim.state[r][c] !== CellState.REVEALED) continue;
        const num = sim.numbers[r][c];
        if (num <= 0) continue;

        let flagged = 0;
        let hiddenCount = 0;
        for (const [nr, nc] of sim.getNeighbors(r, c)) {
          const s = sim.state[nr][nc];
          if (s === CellState.FLAGGED) flagged++;
          else if (s === CellState.HIDDEN) hiddenCount++;
        }

        // 旗子超过数字 → 矛盾
        if (flagged > num) return true;
        // 旗子 + (如果没有隐藏格了) 但旗子数不够数字 → 矛盾
        // 旗子 + 所有隐藏格全标雷 < 数字 → 矛盾（永远不够雷）
        if (flagged + hiddenCount < num) return true;
      }
    }
    return false;
  }
}

// ============================================================
// 导出
// ============================================================

// 版本号，用于检测浏览器缓存
const VERSION = '2.2.0';

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Board, SimBoard, CellState, LogicSolver, NUMBER_COLORS, shuffleArray, VERSION };
}

// 浏览器环境：输出版本号
if (typeof window !== 'undefined') {
  window.__MINESWEEPER_VERSION = VERSION;
  console.log(`[无猜扫雷] 核心引擎 v${VERSION} 已加载`);
}
