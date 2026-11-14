# 流水线命令、产物与验收

目录：1 环境 · 2 命令 · 3 产物 · 4 验收标准 · 5 踩坑记录

## 1. 环境

| 工具 | 要求 | 说明 |
|---|---|---|
| Node.js | 18+ | `new_asset.sh` 会装 three 0.170.0、playwright-core、gltf-validator |
| Chrome | 本机 Google Chrome | 导出、截图都在真实 Chrome 中运行；其他路径用 `CHROME_PATH` 指定 |
| Blender | 4.2+（已用 5.3 验证） | 依次查找 `$BLENDER`、PATH 中的 `blender`、`/Applications/Blender.app` |
| Unity（可选） | 2022.3（已用 2022.3.62f3c1 验证） | `UNITY` 指定编辑器路径；需在 Unity Hub 激活许可证；Apple Silicon 需装 Rosetta 2 |
| glTFast | 6.14.1 | 2022.3.62 能用的最高版本（6.15 起要求 2022.3.67f2）；用 `GLTFAST_VERSION` 覆盖 |

## 2. 命令

在资产工程目录下执行：

```bash
npm start                 # 预览服务 http://127.0.0.1:18780/（PORT 可改）
npm run shoot             # 按 creature.shots 截图 → out/screens/
npm run pipeline          # = export → reference → fbx → bake，全部要成功
npm run unity             # 可选：Unity 批处理导入检查 → out/unity/
npm run unity:capture     # 可选：生成预览场景并在 Play 模式自动截图
```

单步：

| 命令 | 作用 |
|---|---|
| `npm run export` | Chrome 中调用 `window.__rig.exportGLB()` → `out/<name>.glb` + `manifest.json`，再跑 Khronos 校验 |
| `npm run reference` | 读回 GLB，按整帧采样 checkBones 世界坐标 → `reference-samples.json` |
| `npm run fbx` | Blender：GLB → `<name>.fbx`（颜色在顶点色里，只作中间产物） |
| `npm run bake` | Blender：烘出 basecolor / emissive / normal 三张贴图 → `<name>-baked.glb/.fbx`，再校验 |
| `node tools/blender.mjs bake 1024` | 指定烘焙贴图尺寸（默认 2048） |
| `SHOTS=walk:0.3:side EXTRA="model=glb&glb=<name>-baked.glb" SUFFIX=-baked npm run shoot` | 在 Chrome 中读回导出的文件截图，和代码版对比 |

各工具自己起临时服务（随机端口），不需要先 `npm start`。

Unity 工程默认在 `~/.rig-pipeline/unity-project`（`RIG_UNITY_PROJECT` 可改），第一次运行时自动创建并加入 glTFast，之后所有资产共用。资产导入到 `Assets/RigAssets/<name>/`，预览场景是 `Assets/RigViewer/RigViewer.unity`（每次 `unity:viewer` 按当前资产重建）。工程在 Unity 编辑器中打开时脚本会拒绝运行。

## 3. 产物（out/）

| 文件 | 用途 |
|---|---|
| `<name>.glb` | 原版：顶点色 + 平铺纹理 + PBR 扩展，给 Three.js / Babylon / Web 用 |
| `<name>-baked.glb` | **引擎通用版**：单套 UV、三张贴图、无顶点色，给 Godot / Unity(glTFast) / Unreal(glTF) |
| `<name>-baked.fbx` | **引擎通用版 FBX**：贴图内嵌，给 Unity / Unreal / Cocos |
| `textures/<name>_{basecolor,emissive,normal}.png` | 烘焙贴图（FBX 也内嵌了一份） |
| `manifest.json` | SHA-256、骨骼、动画（时长、帧数、循环、事件秒数）、包围盒、材质参数、`meta`、`runtimeNotes` |
| `reference-samples.json` | 骨骼参考坐标 |
| `blender-report.json` / `blender-bake-report.json` / `blender-renders/` | Blender 侧报告和渲染图 |
| `unity/unity-report.json` / `unity/*.png` / `unity/viewer/` | Unity 侧报告和截图 |
| `screens/` | Chrome 截图 |

## 4. 验收标准

全部满足才算交付：

1. 两个 GLB 的 Khronos Validator **0 错误**。允许的已知提示：`NODE_SKINNED_MESH_NON_ROOT`（警告）、`UNUSED_MESH_TANGENT`、`UNUSED_OBJECT`（信息）。
2. Chrome 预览和截图**无页面错误**（工具会把页面错误当失败）。
3. `manifest.baked.glb.roundTripMaxBoneDeltaMeters` < 1e-4（Blender 读回烘焙版 GLB）。
4. 跑了 Unity 时：`unity-report.json` 中 `passed: true`，即两种格式都满足：
   - 不缺动画；
   - 朝 +Z；
   - 最佳坐标映射为 `x->-x`；
   - 骨骼最大误差 < 1 mm（实测在 µm 级）；
   - 骨骼数与 manifest 一致。
5. 截图（Chrome、Blender 渲染、Unity 渲染）人工看过：颜色正确、没有缺面、动作和设计一致。

**不作验收依据**：`manifest.fbx.roundTripMaxBoneDeltaMeters`（Blender 读回 FBX）。导出前的 180° 转向会让 Blender 自己的 FBX 导入器在非 0 帧偏移几十厘米，而 Unity 读同一个文件误差只有 µm 级。FBX 以引擎实测为准。

没跑过的引擎不能说「已验证」，交付说明里要写明只做了静态导出。

## 5. 踩坑记录

已经在模板里处理好的问题，修改模板时不要改回去：

| 现象 | 原因 | 模板里的处理 |
|---|---|---|
| Validator 报关节索引错误 | 权重为 0 的关节仍写了非零索引 | 权重为 0 时索引写 0 |
| Validator 报缺切线或切线非单位长度 | 没生成切线；退化三角形给出非单位向量 | 导出时生成切线、按法线正交化并归一，退化时用备用轴 |
| Validator 报 `emissiveFactor` > 1 | 把强度乘进了颜色 | 颜色 > 1 时归一，多出的部分转成 `emissiveIntensity`（`KHR_materials_emissive_strength`） |
| 动画被重采样、丢第 0 帧 | Blender 默认 24 fps、从第 1 帧开始 | 导入前把场景设为 manifest 的 fps、起始帧 0 |
| FBX 里多出小球网格 | glTF 导入器给骨骼生成的显示形状 | 导出前删除骨骼自定义形状 |
| FBX 在 Unity 里朝 -Z | Unity 的 FBX 导入器按轴向元数据转换并镜像 Z；只改 `axis_forward` 无效 | 导出前在 Blender 里绕竖直轴转 180° 并应用变换 |
| FBX 在 Unity 里通体发白 | 不发光的材质也烘出了白色自发光（Blender 自发光颜色默认白、强度 0；FBX 不带强度） | 自发光强度为 0 的材质烘成黑色 |
| FBX 在 Unity 里缺面 | 预览靠双面材质掩盖了朝内的面；FBX 没有双面标记 | `side: DoubleSide` 的材质导出时补反向面 |
| FBX 在 Unity 里偏哑光、偏灰 | FBX 导入不带粗糙度和自发光强度 | 预览场景按 `manifest.baked.materials` 写材质副本；项目里同样处理 |
| FBX 在 Unity 里没有贴图 | 内嵌贴图没提取 | `ExtractTextures`，并把 `*_normal` 设为 NormalMap |
| Unity 骨骼误差达到厘米级 | 默认开了动画压缩，而且采样落在帧之间 | 关闭压缩；参考采样只取整帧 |
| glTFast 导入报 `SortAndNormalizeBoneWeightsJob` 异常 | 编辑器 Job 调试器对多材质蒙皮误报 | 导入期间临时关闭 Job 调试器 |
| Unity 批处理截图姿势不更新 | 批处理下 `Camera.Render` 不刷新 GPU 蒙皮 | 每个姿势先 `BakeMesh` 到替身再渲染 |
| Unity 退出码 134 | Apple Silicon 缺 Rosetta 2（UnityPackageManager 是 x86_64） | 安装 Rosetta 2 |
| 冻结截图时步态不动 | 动作暂停后 `isRunning()` 为 false | 预览改为直接播放烘焙好的动画，不在运行时解 IK |
