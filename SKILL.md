---
name: threejs-to-3d-model
description: 用 Three.js 代码程序化生成带骨骼动画的 3D 模型（人物、怪物、生物、机甲、道具等），导出标准 GLB，再经 Blender 转 FBX 并烘焙贴图，得到 Unity、Unreal、Godot、Cocos、Web 都能直接使用的资产包，可选在 Unity 中自动导入并逐帧比对骨骼。用户说"生成一个 3D 骨骼动画""做一个会走会攻击的角色/怪物模型""Three.js 模型导出 GLB/FBX""给 Unity/Godot/Unreal 用的带动画模型""Three.js 骨骼动画转 FBX"，或用自然语言描述一个角色、生物或物体并要求做成可用的 3D 动画资产时使用。Generates rigged, animated 3D models from text via procedural Three.js code, exports GLB, converts to FBX with baked textures via Blender, and verifies import in Unity.
---

# Three.js 生成 3D 骨骼动画模型

一条已经跑通的流水线：Three.js 代码（骨骼 + 部件 + 姿态函数 + IK）→ 真实 Chrome 导出 GLB → Blender 转 FBX、烘焙三张贴图 → 引擎导入。

模板自带示例生物（四足甲虫：腿部 IK、软蒙皮尾巴、平铺法线、双面材质、发光材质）。在 Unity 2022.3 实测中，FBX 和 GLB 的骨骼误差都在 1 µm 以内。

## 工作流

复制这份清单并逐项推进：

```
- [ ] 1. 需求 → 规格表，用户确认
- [ ] 2. new_asset.sh 建工程
- [ ] 3. 编写 src/creature.js
- [ ] 4. Chrome 预览截图，用户确认外观和动作
- [ ] 5. npm run pipeline（导出、参考采样、FBX、烘焙）
- [ ] 6. 引擎验证（有 Unity 时 npm run unity / unity:capture）
- [ ] 7. 交付说明
```

**1. 规格表。** 读 [references/design-spec.md](references/design-spec.md)，按其中的模板写规格，内容包括：骨架模板、部件、动画清单（时长、是否循环、事件）、材质、checkBones、facing、机位。描述缺关键信息时，一次最多问 3 个问题，其余用默认值并标注。用户确认前不写代码。

**2. 建工程。** 工程放在用户指定的目录，没指定就问。

```bash
sh <skill>/scripts/new_asset.sh <目标目录>
```

脚本会复制 `assets/template/` 并执行 `npm install`。目标目录必须为空。

**3. 编写 creature.js。** 读 [references/authoring.md](references/authoring.md)。从示例 `src/creature.js` 改起，只改这个文件。通用库 `src/rig-kit.js` 和 tools 只在确实缺功能时才扩展，扩展后要回归测试示例生物。

**4. 预览确认。** 运行 `npm run shoot` 截图（`out/screens/`），把图贴给用户。需要交互查看时让用户运行 `npm start`。动作或外观不对就回到第 3 步。

**5. 流水线。**

```bash
npm run pipeline
```

依次执行 export、reference、fbx、bake，任何一步失败都要停下来修。然后对照 [references/pipeline.md](references/pipeline.md) 的验收标准，检查两个 GLB 的校验结果、manifest 里的误差，并查看 `out/blender-renders/` 的渲染图。

**6. 引擎验证。** 本机有 Unity 2022.3 时运行：

- `npm run unity`：批处理导入 FBX 和 GLB，比对骨骼，截图，结果在 `out/unity/unity-report.json`，要求 `passed: true`。
- `npm run unity:capture`：生成预览场景并在 Play 模式下截图。

其他引擎读 [references/engines.md](references/engines.md) 给出导入步骤。没有实测过的引擎要明确标注「未实测」。

**7. 交付说明。** 写明：

- 产物路径：`out/<name>-baked.fbx`、`-baked.glb`、`<name>.glb`、`textures/`、`manifest.json`。
- 每种目标引擎该用哪个文件。
- 验收数据：校验错误数、骨骼误差、Unity 报告。
- 截图：用 `![](绝对路径)` 嵌入。
- 未验证项和引擎端要做的事：动态发光、根节点位移速度、动画事件。

## 硬性规则

- 一切运动都是 u ∈ [0, 1] 的纯函数；IK 只写在 `afterPose` 里。导出、预览、参考采样共用同一套函数，所以三者逐帧一致。
- 面朝 +Z、+Y 向上、单位米；四肢沿骨骼局部 -Y。
- 不要绕过 Blender 的 180° 转向、自发光置黑、补反向面这些处理。原因见 pipeline.md 的踩坑记录。
- Blender 读回 FBX 的偏差（`manifest.fbx.roundTripMaxBoneDeltaMeters`，常见几十厘米）不作验收依据，FBX 以引擎实测为准。
- 没跑过的步骤不说「已完成」；后台进程退出码为 0 不等于验收通过，要看报告和截图。

## 资源

- `scripts/new_asset.sh`：从模板建工程。
- `assets/template/`：工程模板。
  - `src/rig-kit.js`：通用库。
  - `src/creature.js`：示例生物。
  - `src/preview.js`：预览页。
  - `tools/`：导出、校验、参考采样、截图、调用 Blender。
  - `blender/`：转 FBX、烘焙。
  - `unity/`：导入检查、预览场景、`unity.sh`。
- [references/design-spec.md](references/design-spec.md)：需求整理、骨架模板、动画清单、预算、材质分类。
- [references/authoring.md](references/authoring.md)：creature.js 的定义格式、rig-kit API、编写规则、常用写法。
- [references/pipeline.md](references/pipeline.md)：环境、命令、产物、验收标准、踩坑记录。
- [references/engines.md](references/engines.md)：Unity（实测）、Godot、Unreal、Cocos、Web 的导入要点。
