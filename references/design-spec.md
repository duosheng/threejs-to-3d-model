# 从自然语言到资产规格

目录：1 规格表模板 · 2 骨架模板 · 3 动画清单 · 4 尺寸与预算 · 5 材质分类 · 6 追问清单

用户的描述通常只有一句话（"一只会喷火的三头蜥蜴"）。动手写代码前，先把它整理成下面的规格表给用户确认。规格表里的每一项都要能直接落到 `creature.js` 里。

## 1. 规格表模板

```markdown
## 资产规格：<中文名>（<name，小写连字符>）

- 用途 / 目标引擎：例：Unity 2022 手游 Boss；同时要 Web 预览
- 体型：例：四足 + 长尾，高约 1.2 m，长约 2.5 m，面朝 +Z
- 骨架：模板「四足」+ 尾 4 节 + 颈 2 节 + 下颌；共约 28 根
- 部件（挂在哪根骨骼、用什么几何）：
  | 部件 | 骨骼 | 几何 | 材质 |
  |---|---|---|---|
  | 背甲 | body | shell 开口板 ×3 | shell |
  | 尾 | tail0~3 | skinnedTube（软蒙皮） | skin |
- 动画：
  | 名称 | 时长 | 循环 | 要点 | 事件 |
  |---|---|---|---|---|
  | idle | 2.4 s | 是 | 呼吸、尾摆 | — |
  | walk | 1.0 s | 是 | 原地，对角步态，IK 落脚 | — |
  | attack | 1.2 s | 否 | 蓄力→扑咬→收回 | hit@0.45 |
- 材质：shell（哑光甲壳，程序化法线）、horn（双面）、skin（自发光 0.9）、eye（发光）
- 配色：深绿 #14201a → 亮绿 #9cc46a，发光青绿
- 比对骨骼 checkBones：head、下颌、两条对角小腿、尾尖（覆盖身体各端）
- 朝向骨骼 facing：[head, 尾尖]
- 截图机位 shots：idle@0.1 正面、attack@hit 正面、walk@0.3 侧面
```

## 2. 骨架模板

全部为米制、+Y 向上、面朝 +Z。四肢沿骨骼局部 -Y 下垂，这样 `limb()` 和 `solveTwoBone()` 可以直接用。

| 模板 | 骨骼链 | IK | 说明 |
|---|---|---|---|
| 四足 / 甲虫 | root → body → head(→ 下颌)；每条腿 socket → upper → lower；body → abd0..n | 四条腿各一条两段 IK | 示例 `creature.js` 即此模板 |
| 六足 / 蜘蛛 | 同上，腿 6~8 条 | 每条腿 IK；三角步态：同侧 0、2 与对侧 1 同相 | 腿多时注意三角面预算 |
| 双足 | root → pelvis → spine0..2 → neck → head；pelvis → thigh → shin → foot；spine2 → clavicle → upperArm → foreArm → hand | 腿两段 IK，脚另加一根 | 不是 Unity Humanoid，导入一律 Generic |
| 有翼 | body → wingRoot → wingMid → wingTip（每侧） | 无 | 翼膜用 shell 开口板挂在各段 |
| 蛇形 / 触手 | root → seg0..n（每节沿 -Z） | 无 | 整条 skinnedTube；动画用沿链相位差的正弦 |
| 漂浮 / 机械 | root → core → 若干刚性部件 | 无 | 全刚性，动画以旋转、位移为主 |

命名规则：只用 ASCII 字母和数字；左右用 `L`/`R` 后缀，多条用序号（`upperL0`）。骨骼名会原样出现在 GLB、FBX 和引擎里。

## 3. 动画清单

- 默认至少 `idle`（循环）。用户提到移动就加 `walk`/`run`（循环、原地），提到攻击就加 `attack`（单次，带 `hit` 事件）。常见补充：`hit`（受击 0.4~0.7 s）、`die`（单次 1.5~2.5 s）、`roar`/`skill`。
- 循环动画的周期性函数要用整数周期（`wave(u, n)`），保证首尾帧一致。
- 行走是原地动画。地面速度 = 步幅 ÷ (支撑相比例 × 周期)，写进 `meta.walkSpeed`，引擎端用它移动根节点。
- 事件用 0~1 的进度写在 clip 的 `events` 里，导出时换算成秒。

## 4. 尺寸与预算

| 目标 | 三角面 | 骨骼 | 贴图 |
|---|---|---|---|
| 手游小怪 | ≤ 5k | ≤ 30 | 512~1024 |
| 手游 Boss | ≤ 20k | ≤ 60 | 1024~2048 |
| PC / 主机 | ≤ 80k | ≤ 100 | 2048~4096 |

烘焙贴图尺寸用 `npm run bake` 后面的参数指定（例：`node tools/blender.mjs bake 1024`）。几何细分主要由 `shell` 的 `seg/rings`、`limb` 的 `radial/rings`、`blob` 的 `width/height` 控制。

## 5. 材质分类

材质按「key」分组，每个 key 导出为一个子网格 + 一个材质。key 不宜多（4~6 个）。

| 典型 key | Three.js 材质 | 导出要点 |
|---|---|---|
| shell / skin | MeshPhysicalMaterial / MeshStandardMaterial，顶点色 + 程序化法线 | 平铺 repeat 会烘进 UV；清漆只保留在 GLB |
| horn / blade | MeshStandardMaterial，可设 `side: DoubleSide` | 双面材质导出时自动补反向面 |
| glow（囊、眼、管） | MeshStandardMaterial 带 emissive，或 MeshBasicMaterial | Basic 自动转成发光 Standard；颜色分量 > 1 会转成发光强度 |

不支持导出：ShaderMaterial、透射/折射、运行时改变的发光强度（只能在引擎端用脚本复现，写进 `notes`）。

## 6. 追问清单

用户描述不完整时，优先问这几项（一次最多问 3 个，其余用合理默认值并在规格表里标注「默认」）：

1. 目标引擎和平台（决定面数、贴图尺寸、是否需要 FBX）。
2. 需要哪些动画（默认 idle / walk / attack）。
3. 大致尺寸和风格参考（默认按真实生物比例，高 1 m 左右）。
4. 是否需要特殊部件：武器、翅膀、发光部位、可替换部件。
