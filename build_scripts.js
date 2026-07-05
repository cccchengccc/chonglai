/**
 * 剧本数据构建器
 * 从 .md 文件提取场景数据，生成游戏引擎可用的 JSON
 *
 * 用法: node build_scripts.js
 * 输出: scripts/ISTP.json, scripts/ENFP.json, ...
 */

const fs = require('fs');
const path = require('path');

// 需要转换的剧本
const SCRIPTS = [
  'ISTP', 'ISTJ', 'ISFP', 'ISFJ', 'INTP', 'INFP', 'INTJ', 'INFJ',
  'ESTP', 'ESTJ', 'ESFP', 'ESFJ', 'ENTP', 'ENTJ', 'ENFP', 'ENFJ'
];

// 映射表: 原信任值 → 新值(理想线, 现实线)
const TRUST_MAP = {
  '+25': [10, 8], '+20': [8, 6], '+15': [6, 4], '+10': [4, 3], '+5': [2, 1],
  '0': [0, 0],
  '-5': [-8, -10], '-10': [-15, -18], '-15': [-20, -25], '-20': [-25, -30],
  '-25': [-30, -35], '-30': [-35, -40], '-35': [-40, -45], '-40': [-45, -50],
};

function parseTrustChange(text) {
  // .md 文件中的信任值已经过映射，直接解析数值即可
  const result = { 理想线: 0, 现实线: 0, fatalError: null };

  const idealMatch = text.match(/理想线\s*([+-]?\d+)/);
  const realMatch = text.match(/现实线\s*([+-]?\d+)/);

  if (idealMatch) result.理想线 = parseInt(idealMatch[1]);
  if (realMatch) result.现实线 = parseInt(realMatch[1]);

  if (text.includes('致命错误')) result.fatalError = true;
  // 检查是否有「暗雷」标记
  if (text.includes('暗雷')) result.fatalError = true;

  return result;
}

function extractSceneData(mdContent) {
  const lines = mdContent.split('\n');
  const scenes = {};
  let currentScene = null;
  let currentOption = null;
  let inOptions = false;
  let section = null;

  for (const line of lines) {
    // 捕获场景标题
    const sceneMatch = line.match(/^场景 (S-[\dE]+)：(.*)/);
    if (sceneMatch) {
      currentScene = sceneMatch[1];
      const title = sceneMatch[2];
      inOptions = false;
      currentOption = null;

      scenes[currentScene] = {
        id: currentScene,
        title: title,
        type: null,
        narrative: '',
        dialogue: '',
        sceneHint: '',
        options: [],
        onEnter: null,
      };
      continue;
    }

    if (!currentScene) continue;

    // 场景类型
    const typeMatch = line.match(/^【场景类型】(.*)/);
    if (typeMatch) {
      const t = typeMatch[1].trim();
      scenes[currentScene].type =
        t.includes('核心') ? 'core' :
        t.includes('游离') ? 'free_roam' :
        t.includes('专属') ? 'exclusive' : 'branch';
      continue;
    }

    // 出场规则
    const appearMatch = line.match(/^【出场规则】(.*)/);
    if (appearMatch) {
      const rule = appearMatch[1];
      scenes[currentScene].appearRule = rule.trim();
      continue;
    }

    // 伏笔
    const fbMatch = line.match(/^【伏笔.*?】(F-[\d]+)/);
    if (fbMatch) {
      scenes[currentScene].foreshadowCheck = fbMatch[1];
      continue;
    }

    // 前置条件
    const condMatch = line.match(/^【前置条件】(.*)/);
    if (condMatch) {
      scenes[currentScene].condition = condMatch[1].trim();
      continue;
    }

    // 叙事文本
    if (line.startsWith('【叙事文本】')) {
      section = 'narrative';
      continue;
    }

    // 角色台词
    if (line.startsWith('【角色台词】')) {
      section = 'dialogue';
      continue;
    }

    // 选项开始
    const optMatch = line.match(/^【选项 ([A-C])】/);
    if (optMatch) {
      currentOption = {
        id: optMatch[1],
        text: '',
        reaction: '',
        trustChange: { 理想线: 0, 现实线: 0 },
        flagOps: {},
        plotOps: {},
        nextScene: null,
        condition: null,
        fatalError: null,
      };
      inOptions = true;
      section = 'opt_text';
      continue;
    }

    // 按钮文本
    if (line.startsWith('按钮文本：')) {
      if (currentOption) {
        currentOption.text = line.replace('按钮文本：', '').trim();
        section = 'opt_behavior';
      }
      continue;
    }

    // 行为描述
    if (line.startsWith('行为描述：')) {
      if (currentOption) {
        section = 'opt_reaction';
      }
      continue;
    }

    // 角色反应
    if (line.startsWith('{TA} 反应：') || line.match(/^[A-Z]+ 反应：/)) {
      if (currentOption) {
        currentOption.reaction = line.replace(/^[^：]+：/, '').trim();
        section = 'opt_hint';
      }
      continue;
    }

    // 环境暗示
    if (line.startsWith('环境暗示：')) {
      if (currentOption) {
        section = 'opt_final';
      }
      continue;
    }

    // 伏笔操作
    if (line.startsWith('伏笔操作：')) {
      if (currentOption) {
        const op = line.replace('伏笔操作：', '').trim();
        if (op.includes('变为"已触发"')) {
          currentOption.plotOps['F-' + op.match(/F-(\d+)/)?.[1]] = '已触发';
        }
        section = 'opt_flag';
      }
      continue;
    }

    // Flag操作
    if (line.startsWith('Flag 操作：')) {
      if (currentOption) {
        const op = line.replace('Flag 操作：', '').trim();
        const anchorMatch = op.match(/(Anchor-[\d]+)/);
        if (anchorMatch && op.includes('触发')) {
          currentOption.flagOps[anchorMatch[1]] = true;
        }
        section = 'opt_trust';
      }
      continue;
    }

    // 信任值变化
    if (line.startsWith('信任值变化：')) {
      if (currentOption) {
        const change = parseTrustChange(line);
        currentOption.trustChange = change;
        if (change.fatalError) {
          currentOption.fatalError = true;
        }
      }
      // 对于非选项行，跳过后面的文本累积
      section = 'opt_next';
      continue;
    }

    // 跳转 或 结局导向（都标记选项结束）
    if (line.startsWith('跳转：') || line.startsWith('结局导向：')) {
      if (currentOption) {
        if (line.startsWith('跳转：')) {
          const target = line.replace('跳转：', '').trim();
          if (target.includes('终局判定')) {
            currentOption.nextScene = '__ENDING__';
            const beMatch = target.match(/(BE-[\d])/);
            if (beMatch) currentOption.fatalError = beMatch[1];
          } else {
            currentOption.nextScene = target;
          }
        } else {
          // 结局导向 — 终局选项
          currentOption.nextScene = '__ENDING__';
        }
        // 保存选项
        scenes[currentScene].options.push(currentOption);
        currentOption = null;
      }
      continue;
    }

    // 前条件
    if (line.startsWith('前置条件：')) {
      if (currentOption) {
        const cond = line.replace('前置条件：', '').trim();
        if (cond !== '无') currentOption.condition = cond;
      }
      continue;
    }

    // 累积叙事文本
    if (section === 'narrative' && line.trim()) {
      // 跳过纯场景元数据
      if (!line.startsWith('【') && !line.startsWith('场景 ')) {
        scenes[currentScene].narrative += line + '\n';
      }
    }

    // 累积台词（去掉人格代号前缀）
    if (section === 'dialogue' && line.trim()) {
      let clean = line.trim();
      // 去掉 ENFP： "..."、ISTP：“...” 之类的前缀
      clean = clean.replace(/^[A-Z]+[：:]\s*/, '');
      // 去掉 {TA} 反应： 前缀（保留内容）
      clean = clean.replace(/^\{TA\}\s*反应[：:]\s*/, '');
      // 去掉 人格名 反应： 前缀
      clean = clean.replace(/^[A-Z]+\s*反应[：:]\s*/, '');
      scenes[currentScene].dialogue += clean + '\n';
    }

    // 累积选项文本
    if (section === 'opt_reaction' && line.trim() && currentOption) {
      currentOption.reaction += line.trim() + '\n';
    }

    // 累积行为描述或环境暗示
    if (section === 'opt_hint' && line.trim() && currentOption) {
      scenes[currentScene].sceneHint += line.trim() + '\n';
    }
  }

  return scenes;
}

function extractEndings(mdContent) {
  const endings = {};
  const lines = mdContent.split('\n');
  let currentEnding = null;

  for (const line of lines) {
    const startMatch = line.match(/^([A-Z]+-[\d])：(.+)/);
    if (startMatch) {
      currentEnding = startMatch[1];
      endings[currentEnding] = { title: startMatch[2].trim(), text: '' };
      continue;
    }

    if (currentEnding && line.trim() && !line.startsWith('#')) {
      endings[currentEnding].text += line + '\n';
    }
  }

  return endings;
}

function buildScript(scriptName) {
  const mdPath = path.join(__dirname, `${scriptName}.md`);
  const mdContent = fs.readFileSync(mdPath, 'utf-8');

  // 提取元数据
  const meta = { id: scriptName, name: '', theme: '', startingTrust: 30 };
  const nameMatch = mdContent.match(/人格名称\t(.+)/);
  if (nameMatch) meta.name = nameMatch[1].trim();
  const themeMatch = mdContent.match(/核心主题\t(.+)/);
  if (themeMatch) meta.theme = themeMatch[1].trim();

  // 提取场景数据
  const scenes = extractSceneData(mdContent);

  // 提取结束数据
  const endings = extractEndings(mdContent);

  // 提取裂痕记忆
  const 裂痕记忆 = {};
  const 裂痕Sections = mdContent.match(/【裂痕类型[^】]+】[\s\S]*?(?=【|$)/g);
  if (裂痕Sections) {
    裂痕Sections.forEach((s, i) => {
      const nameMatch = s.match(/【裂痕类型[^】]+】\s*\n\n背景故事：(.*?)\n\nS-01特殊旁白：/s);
      const 旁白Match = s.match(/S-01特殊旁白：["”]?(.*?)["”]/);
      裂痕记忆[`type_${i}`] = {
        background: nameMatch ? nameMatch[1].trim() : '',
        specialNarrative: 旁白Match ? 旁白Match[1].trim() : '',
      };
    });
  }

  // 提取碎片记忆
  const memories = {};
  const memSection = mdContent.match(/七、碎片记忆系统[\s\S]*?八、/);
  if (memSection) {
    const memLines = memSection[0].split('\n');
    for (const line of memLines) {
      const memMatch = line.match(/^(\d+)\t(.+?)\t(.+)/);
      if (memMatch) {
        memories[`mem_${memMatch[1]}`] = {
          condition: memMatch[2].trim(),
          text: memMatch[3].trim(),
        };
      }
    }
  }

  // 为 PE-1 和 GE-1 添加变体
  endings['PE-1'] = endings['PE-1'] || { title: '', text: '' };
  endings['GE-1'] = endings['GE-1'] || { title: '', text: '' };
  
  endings['PE-1'].variants = {
    'F-01_triggered': '\n\n你注意到了{TA}停下的那个瞬间。那不是放弃——那是{TA}在等你发现。',
    'F-01_not_triggered': '\n\n你没有注意到{TA}是什么时候停下的。但{TA}还在。',
    'F-02_triggered': '\n\n{TA}不再把修好的东西藏起来了。{TA}学会了把"做了"翻译成"告诉你"。',
    'F-02_not_triggered': '\n\n{TA}还是习惯用行动说话。但你开始学习读懂那些没有翻译的语言。',
    'F-03_triggered': '\n\n那张{TA}写着关于{TA}的纸——{TA}不再藏在工具箱夹层里了。',
    'F-04_triggered': '\n\n{TA}留在你空间里的东西——{TA}不再悄悄地收走了。',
  };
  endings['GE-1'].variants = {
    'F-01_triggered': '\n\n你注意到了{TA}停下的那个瞬间。那不是放弃——那是{TA}在等你发现。',
    'F-03_triggered': '\n\n那张纸还留在工具箱里。但{TA}开始让你看到了。',
  };
  
  return { meta, scenes, endings, 裂痕记忆, memories };
}

// 主函数
function main() {
  const outDir = path.join(__dirname, 'scripts');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  for (const name of SCRIPTS) {
    try {
      const data = buildScript(name);
      const outPath = path.join(outDir, `${name}.json`);
      fs.writeFileSync(outPath, JSON.stringify(data, null, 2), 'utf-8');
      console.log(`✓ ${name} (${Object.keys(data.scenes).length} scenes)`);
    } catch (e) {
      console.error(`✗ ${name}: ${e.message}`);
    }
  }
  console.log('\nDone!');
}

main();
