/**
 * 《重来》 MBTI 人格挽回模拟器 - 核心游戏引擎
 * 纯原生 JS，不依赖任何框架
 */

class GameEngine {
  constructor(dataLoader) {
    this.dataLoader = dataLoader;       // 剧本数据加载器
    this.state = null;                   // 当前游戏状态
    this.listeners = [];                 // 状态变更监听器
    this.sceneQueue = [];                // 当前局场景队列
  }

  /** 开始新游戏 */
  async startGame(personality, difficulty, partnerGender) {
    const scriptData = await this.dataLoader.load(personality);

    // 初始化游戏状态
    this.state = {
      gameId: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      personality,
      personalityName: scriptData.meta.name,
      difficulty,
      partnerGender,
      trust: 30,               // 优化后的起始值
      currentScene: null,
      sceneHistory: [],
      flags: {},               // Anchor Flag: true/false
      plotFlags: {},           // F-01~F-04: '未触发'|'已触发'
     裂痕记忆: null,
     裂痕类型: null,
      activeEvents: [],
      unlockedMemories: [],
     致命错误: { S03: false, S06: false, S04: false },
      trustHistory: [{ scene: '__start__', trust: 30 }],  // 信任值变化历史
      choiceHistory: [],  // 选择历史 [{scene, optionId, text, trustChange}]
    };

    // 初始化 Flag
    for (let i = 1; i <= 9; i++) this.state.flags[`Anchor-${String(i).padStart(2, '0')}`] = false;
    for (let i = 1; i <= 4; i++) this.state.plotFlags[`F-${String(i).padStart(2, '0')}`] = '未触发';

    // 随机裂痕记忆
    this.state.裂痕类型 = Math.floor(Math.random() * 3); // 0, 1, 2

    // 生成场景队列
    this.sceneQueue = this._generateSceneQueue(scriptData, difficulty);
    this.state.activeEvents = this.sceneQueue.filter(s => s.startsWith('S-E'));

    // 进入第一个场景
    await this.enterScene(this.sceneQueue[0], scriptData);
    this._notify({ type: 'gameStart' });
    return this.state;
  }

  /** 生成肉鸽场景队列（游离事件浮动插入算法） */
  _generateSceneQueue(scriptData, difficulty) {
    // 核心场景顺序
    let queue = ['S-01', 'S-02'];

    // 现实线插入 S-03
    if (difficulty === '现实线') queue.push('S-03');

    // 可用插入空位
    let slots = [];
    for (let i = 1; i <= queue.length; i++) slots.push(i);

    // 游离事件 30% 概率独立判定
    let activeEvents = [];
    ['S-E1', 'S-E2', 'S-E3'].forEach(e => {
      if (Math.random() < 0.3) activeEvents.push(e);
    });

    // 随机分配到空位
    activeEvents.forEach(e => {
      if (slots.length === 0) return;
      const idx = Math.floor(Math.random() * slots.length);
      queue.splice(slots[idx], 0, e);
      slots.splice(idx, 1);
    });

    // 支线 S-05/S-06 二选一
    if (difficulty === '现实线' && Math.random() < 0.5) {
      queue.push('S-06');
    } else {
      queue.push('S-05');
    }

    // 游离事件 S-E3 可能在支线后
    // 如果 S-E3 还没出场，再试一次
    if (!activeEvents.includes('S-E3') && Math.random() < 0.3) {
      queue.push('S-E3');
    }

    // 终局
    queue.push('S-07');

    return queue;
  }

  /** 处理玩家选择 */
  async chooseOption(optionId) {
    const scriptData = await this.dataLoader.load(this.state.personality);
    const scene = scriptData.scenes[this.state.currentScene];
    if (!scene) return;

    const option = scene.options.find(o => o.id === optionId);
    if (!option) return;

    const diff = this.state.difficulty;

    // 1. 检查前置条件
    if (option.condition && !this._checkCondition(option.condition)) {
      return; // 条件不满足，不可选
    }

    // 2. 信任值变化
    if (option.trustChange && option.trustChange[diff]) {
      this.state.trust += option.trustChange[diff];
      this.state.trust = Math.max(0, Math.min(100, this.state.trust));
    }
    // 记录信任值历史
    this.state.trustHistory.push({
      scene: this.state.currentScene,
      trust: this.state.trust,
      change: option.trustChange ? option.trustChange[diff] || 0 : 0,
    });
    // 记录选择历史
    this.state.choiceHistory.push({
      scene: this.state.currentScene,
      optionId,
      text: option.text,
      trustChange: option.trustChange ? option.trustChange[diff] || 0 : 0,
    });

    // 3. Flag 操作
    if (option.flagOps) {
      Object.entries(option.flagOps).forEach(([key, val]) => {
        if (key.startsWith('Anchor')) {
          this.state.flags[key] = val;
        }
      });
    }

    // 4. 伏笔操作
    if (option.plotOps) {
      Object.entries(option.plotOps).forEach(([key, val]) => {
        if (key.startsWith('F-')) {
          this.state.plotFlags[key] = val;
        }
      });
    }

    // 5. 检测致命错误
    if (option.fatalError) {
      if (option.fatalError === 'S03') this.state.致命错误.S03 = true;
      if (option.fatalError === 'S06') this.state.致命错误.S06 = true;
      if (option.fatalError === 'S04') this.state.致命错误.S04 = true;
    }

    // 6. 碎片记忆解锁
    if (option.memory) {
      if (!this.state.unlockedMemories.includes(option.memory)) {
        this.state.unlockedMemories.push(option.memory);
      }
    }

    // 7. 跳转
    const nextScene = this._resolveNextScene(option.nextScene, scriptData);
    this.state.sceneHistory.push(this.state.currentScene);

    // 检查是否为终局判定
    if (nextScene === '__ENDING__') {
      const ending = this._determineEnding();
      this.state.currentScene = null;
      this._notify({ type: 'ending', ending, state: { ...this.state } });
      return ending;
    }

    await this.enterScene(nextScene, scriptData);
    this._notify({ type: 'choice', optionId, nextScene });
    return nextScene;
  }

  /** 进入场景 */
  async enterScene(sceneId, scriptData) {
    if (!scriptData) scriptData = await this.dataLoader.load(this.state.personality);

    this.state.currentScene = sceneId;
    const scene = scriptData.scenes[sceneId];
    if (!scene) return;

    // 获取场景变体（根据 Flag 状态适配文本）
    const variant = this._getSceneVariant(scene, this.state);

    // 渲染模板变量
    const rendered = this._renderTemplates(variant, this.state.partnerGender);

    this._notify({ type: 'scene', sceneId, scene: rendered, state: { ...this.state } });
    return rendered;
  }

  /** 获取场景文本变体（防御性跳转） */
  _getSceneVariant(scene, state) {
    // 如果有 onEnter 条件，根据 Flag 状态返回变体
    if (scene.onEnter && scene.onEnter.conditions) {
      for (const cond of scene.onEnter.conditions) {
        if (this._checkCondition(cond.check)) {
          return {
            narrative: cond.narrative || scene.narrative,
            dialogue: cond.dialogue || scene.dialogue,
            options: cond.modifiedOptions || scene.options,
           伏笔检验: cond.plotCheck || scene.伏笔检验,
          };
        }
      }
    }
    return scene;
  }

  /** 渲染 {TA} 模板变量 */
  _renderTemplates(scene, gender) {
    const ta = gender === 'male' ? '他' : '她';
    const taDe = gender === 'male' ? '他的' : '她的';
    const taSelf = gender === 'male' ? '他自己' : '她自己';

    const render = (text) => {
      if (!text) return text;
      return text
        .replace(/\{TA\}/g, ta)
        .replace(/\{TA的\}/g, taDe)
        .replace(/\{TA自己\}/g, taSelf);
    };

    return {
      ...scene,
      narrative: render(scene.narrative),
      dialogue: render(scene.dialogue),
      options: scene.options.map(opt => ({
        ...opt,
        text: render(opt.text),
        reaction: render(opt.reaction),
      })),
      sceneHint: render(scene.sceneHint),
    };
  }

  /** 双轨结局判定 */
  _determineEnding() {
    const { trust, flags, 致命错误 } = this.state;

    // Step 1: Flag锁定检查
    if (致命错误.S03) return 'BE-1';
    if (致命错误.S06) return 'BE-2';
    if (致命错误.S04) return 'BE-3';

    // Step 2: 关键Flag突破
    if (flags['Anchor-06'] && flags['Anchor-02'] && flags['Anchor-05']) {
      return trust >= 80 ? 'PE-1' : 'GE-1';
    }
    if (flags['Anchor-06'] && flags['Anchor-01'] && flags['Anchor-04'] && flags['Anchor-09']) {
      return trust >= 80 ? 'PE-1' : 'GE-1';
    }

    // Step 3: Flag不足锁定上限
    const keyCount = ['Anchor-01', 'Anchor-02', 'Anchor-03', 'Anchor-04', 'Anchor-05']
      .filter(k => flags[k]).length;
    if (keyCount <= 2 && trust >= 70) return 'GE-1';

    // Step 4: 信任值兜底
    if (trust < 30) return 'BE-1';
    if (trust < 50) return 'BE-2';
    if (trust < 60) return 'BE-3';
    if (trust < 70) return 'NE-1';
    if (trust < 85) return 'GE-1';
    return 'GE-1';
  }

  /** 获取复盘数据 */
  getRecap() {
    return {
      personality: this.state.personality,
      personalityName: this.state.personalityName,
      difficulty: this.state.difficulty,
      partnerGender: this.state.partnerGender,
      裂痕类型: this.state.裂痕类型,
      trust: this.state.trust,
      trustHistory: this.state.trustHistory,
      choiceHistory: this.state.choiceHistory,
      flags: { ...this.state.flags },
      plotFlags: { ...this.state.plotFlags },
      sceneHistory: [...this.state.sceneHistory],
      unlockedMemories: [...this.state.unlockedMemories],
      flagCount: Object.values(this.state.flags).filter(Boolean).length,
    };
  }

  /** 保存结局到图鉴 */
  static saveEndingToGallery(personality, endingCode, trust) {
    try {
      const gallery = JSON.parse(localStorage.getItem('chonglai_gallery') || '{}');
      if (!gallery[personality]) gallery[personality] = [];
      const exists = gallery[personality].some(e => e.ending === endingCode);
      if (!exists) {
        gallery[personality].push({ ending: endingCode, trust, date: Date.now() });
        localStorage.setItem('chonglai_gallery', JSON.stringify(gallery));
      }
      return true;
    } catch(e) { return false; }
  }

  /** 读取结局图鉴 */
  static getGallery() {
    try {
      return JSON.parse(localStorage.getItem('chonglai_gallery') || '{}');
    } catch(e) { return {}; }
  }

  /** 解析跳转目标 */
  _resolveNextScene(nextSceneDef, scriptData) {
    if (!nextSceneDef) return null;
    if (nextSceneDef === '__ENDING__') return '__ENDING__';

    // 处理条件跳转
    if (typeof nextSceneDef === 'object') {
      for (const [condition, target] of Object.entries(nextSceneDef)) {
        if (condition === 'default') continue;
        if (this._checkCondition(condition)) return target;
      }
      return nextSceneDef.default || null;
    }

    return nextSceneDef;
  }

  /** 检查条件表达式 */
  _checkCondition(condition) {
    if (!condition) return true;
    try {
      // 支持简单条件： "flags.Anchor-02 === true && flags.F-02 === '已触发'"
      const ctx = {
        flags: this.state.flags,
        plotFlags: this.state.plotFlags,
        trust: this.state.trust,
        difficulty: this.state.difficulty,
      };
      return new Function('ctx', `with(ctx) { return ${condition}; }`)(ctx);
    } catch (e) {
      console.warn('Condition check failed:', condition, e);
      return false;
    }
  }

  /** 获取裂痕记忆文本 */
  get裂痕记忆(scriptData) {
    if (!scriptData.裂痕记忆) return null;
    return scriptData.裂痕记忆[this.state.裂痕类型];
  }

  /** 获取碎片记忆 */
  getUnlockedMemories(scriptData) {
    if (!scriptData.memories) return [];
    return this.state.unlockedMemories
      .map(id => scriptData.memories[id])
      .filter(Boolean);
  }

  /** 订阅事件 */
  subscribe(listener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  /** 通知监听器 */
  _notify(event) {
    this.listeners.forEach(l => l(event));
  }

  /** 保存到本地存储 */
  saveGame() {
    try {
      localStorage.setItem('chonglai_save', JSON.stringify({
        state: this.state,
        sceneQueue: this.sceneQueue,
        timestamp: Date.now(),
      }));
      return true;
    } catch (e) {
      console.warn('Save failed:', e);
      return false;
    }
  }

  /** 从本地存储加载 */
  loadGame() {
    try {
      const data = JSON.parse(localStorage.getItem('chonglai_save'));
      if (data && data.state) {
        this.state = data.state;
        this.sceneQueue = data.sceneQueue || [];
        return true;
      }
    } catch (e) {
      console.warn('Load failed:', e);
    }
    return false;
  }

  /** 删除存档 */
  deleteSave() {
    localStorage.removeItem('chonglai_save');
  }
}

// 导出
if (typeof module !== 'undefined') module.exports = { GameEngine };
