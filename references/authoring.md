# 编写 creature.js

目录：1 定义对象 · 2 rig-kit API · 3 编写规则 · 4 常用写法 · 5 视觉质量 · 6 自检

每个新资产只改 `src/creature.js`。`rig-kit.js`、`preview.js` 和 tools 都是通用的，除非确实缺功能，否则不要改。示例 `creature.js`（四足甲虫）覆盖了所有特性，新资产从它改起。

## 1. 定义对象

`export default function createCreature()` 返回：

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` | 是 | 小写连字符，决定所有文件名（`<name>.glb`、`<name>-baked.fbx`…） |
| `title` | 否 | 预览页标题 |
| `rig` | 是 | `new Rig()`，已加好骨骼和部件 |
| `materials` | 是 | `{ key: THREE.Material }`，顺序即子网格顺序 |
| `rest` | 是 | 绑定姿势（pose 对象） |
| `clips` | 是 | `{ name: { duration, loop, pose(u), events?, label? } }` |
| `afterPose(rig, clip, u)` | 否 | 每帧在姿态之后调用，用来解 IK；`clip` 为 `null` 表示绑定姿势 |
| `checkBones` | 是 | 4~6 根覆盖身体各端的骨骼，用于跨工具比对 |
| `facing` | 是 | `[前端骨骼, 后端骨骼]`，检查模型是否朝 +Z |
| `shots` | 否 | `[{ clip, t, view: 'front'|'side'|'back', zoom? }]`，截图和渲染机位 |
| `meta` | 否 | 写进 manifest 的任意数据，如 `walkSpeed` |
| `notes` | 否 | 写进 manifest 的引擎端注意事项 |
| `preview` | 否 | `{ background, stage }`。`stage` 可选 `'studio'`（默认）或 `'volcanic'`（暗色火山场景，带强轮廓光），只影响预览 |
| `shading` | 否 | `{ ao, radius, sky, tint, exclude }`，把 AO 和底面压暗烘进顶点色；`exclude` 列出发光和特效材质 |
| `onFrame(ctx)` | 否 | 仅预览用的逐帧回调（如呼吸灯），不进入导出 |

pose 对象：`{ boneName: { r: [x, y, z], p?: [x, y, z], s?: number | [x, y, z] } }`，`s` 是缩放（例如把火焰骨骼链缩进嘴里藏起来），偏离 1 的部分会导出 scale 轨道。`r` 是 Euler **YXZ** 弧度，`p` 是局部位置。每帧先把所有骨骼复位到建骨时的位置和零旋转，再套用 pose，没写到的骨骼保持零旋转。

## 2. rig-kit API

骨骼与部件：

- `rig.bone(name, parent = null, p = [0,0,0])`：建骨。`parent` 为 `null` 时挂在根组上。
- `rig.part(bone, key, geometry)`：刚性部件，几何在该骨骼的局部空间。
- `rig.skin(key, bones, build)`：软蒙皮。`build(jointWorldPositions)` 在绑定姿势下调用，返回 rig 空间几何，`skinIndex` 指向 `bones` 数组下标。一般直接返回 `skinnedTube(...)`。

几何（都返回 `BufferGeometry`，可以继续 `.translate()` / `.rotateX()`）：

- `limb(len, r0, r1, { bulge, flat, curve, radial, rings, color(t) })`：从原点沿 -Y 下垂的锥形肢段。
- `spike(len, rad, { bend, axis, radial, rings, color(t) })`：沿 +Y 的尖刺或角。
- `scute(len, width, height, { keel, taper, lift, rings, color(t,e) })`：沿 +Z 的闭合倒角板，底面在 y = 0，可做甲片、护甲板、零件面板。
- `blob(radius, { scale, width, height, color(x,y,z) })`：椭球。
- `shell({ length, radius(t), cover, seg, rings, flatten, keel, grooves, dir, color(t,e) })`：沿 ±Z 的壳或管（甲壳、头盔、护甲、枪管、衣袖）；`cover < TAU` 时是开口的壳。
- `skinnedTube(joints, radii, { perSeg, radial, flatten, color(v, s) })`：沿骨链的软管，权重在相邻两节之间渐变。
- `place(geo, p, r, s)`：平移、旋转（YXZ）、缩放。`colorize(geo, fn | color)`：写顶点色。`mix(a, b, t)`：颜色插值（返回共享临时对象，立即使用）。

贴图：

- `proceduralTexture((u, v) => ({ h, color? }), { size, normalStrength, repeat })` 返回 `{ normal, albedo }`，可平铺。`fbm(u, v, period, seed)` 和 `cellular(u, v, cx, cy, seed)` 是可平铺噪声。

姿态与动画：

- `clonePose`、`withPose(base, overlay)`、`lerpPose(a, b, t)`。
- `timeline([[u0, pose0], [u1, pose1, ease], ...])` 返回 `pose(u)`；ease 作用于以该关键帧结尾的那一段。
- 缓动：`smooth`、`easeIn`、`easeOut`；`wave(u, cycles, phase)` 用于循环。

IK：

- `solveTwoBone({ root, upper, lower, upperLen, lowerLen, pole }, targetWorld)`。`upper` 是 `root` 的子骨骼，`lower` 位于 `upper` 下 `[0, -upperLen, 0]`，末端在 `lower` 下 `[0, -lowerLen, 0]`；`pole` 是膝盖弯向的世界方向。
- `gaitStep(phase, { stride, stance, lift })` 返回 `{ dz, lift }`，加到静止落脚点上。

## 3. 编写规则

1. **面朝 +Z、+Y 向上、单位米。** 地面是 y = 0，绑定姿势下脚落在地面上。
2. **四肢沿局部 -Y 下垂。** 子骨骼放在 `[0, -len, 0]`，部件用 `limb()`，IK 才能直接用。
3. **一切运动都写成 u ∈ [0, 1] 的纯函数。** 不读时钟、不用随机数，同一 u 永远给同一姿势。导出、预览、参考采样都依赖这一点。
4. **IK 只在 `afterPose` 里解。** 导出时逐帧烘进旋转，引擎端不需要 IK。
5. **循环动画首尾一致。** 用 `wave(u, 整数)`，步态相位也按整周期设计。
6. **位移轨道自动判断。** 某骨骼的位置在任一帧偏离建骨位置，就导出它的 position 轨道（通常只有 body）。
7. **只用能导出的东西。** 运行时改材质、粒子、后处理都不进 GLB，需要时写进 `notes`，或放在 `onFrame` 里只作预览。
8. **几何法线朝外。** `shell` 已按 `dir` 处理绕序；自己拼的几何如果有朝内的面，就给该材质设 `side: DoubleSide`，导出时会自动补反向面。
9. **checkBones 选末端。** 头、尾尖、手脚末端、武器，这样任何轴向或缩放错误都会被比对发现。

## 4. 常用写法

关键帧攻击：

```js
const WIND = key({...}); const STRIKE = key({...});
attack: { duration: 1.2, loop: false, events: { hit: 0.45 },
  pose: timeline([[0, rest], [0.35, WIND], [0.45, STRIKE, easeIn], [0.6, STRIKE], [1, rest]]) },
```

叠加呼吸和摆动：

```js
pose: (u) => { const p = clonePose(rest); p.body.p[1] += 0.015 * wave(u); p.tail0.r[1] = 0.1 * wave(u, 1, -0.7); return p; }
```

步态 IK：

```js
afterPose(_rig, clip, u) {
  for (const leg of legs) {
    target.copy(leg.foot);
    if (clip === 'walk') { const { dz, lift } = gaitStep(u + leg.phase, GAIT); target.z += dz; target.y += lift; }
    solveTwoBone(leg.chain, target);
  }
}
```

对角步态相位：左前、右后为 0，右前、左后为 0.5。六足三角步态：L0、R1、L2 为 0，其余为 0.5。

## 5. 视觉质量

模型看起来「简陋」，原因通常不在图元太少（`limb`/`shell`/`spike`/`blob` 就足够做出 boss 级效果），而在下面几条。它们和题材无关，人、怪物、机械、道具都适用；按题材怎么落地，看本节末尾的表。

**形体：先大后小，分大、中、小三级。**

- **大件决定剪影。** 先用少数几个大而清楚的形体把轮廓立住：比例夸张一点的躯干和四肢，加上这个角色最有辨识度的大部件（武器、头盔、披风、角、背包、尾巴……）。不要用几百个小零件去堆，远看只是噪点。
- **中件交代结构。** 每段身体配一两个中等部件：护甲、口袋、皮带、关节护垫、枪械的弹匣和瞄具。
- **小件只放在视觉焦点上。** 脸、手、武器前端这些用户会盯着看的地方才堆细节，其余的交给法线贴图。
- **部件要贴合、要层叠，不能悬空，也不能埋进身体。** 外层件要明显高出内层，边缘互相压住（衣服压皮肤、护甲压衣服、甲片压甲片）。
- **方向用基向量摆。** 「沿 a→b、顶面朝 up」的部件用 `makeBasis(up×f, up, f)` 构造矩阵，比手调 Euler 可靠。不确定骨骼局部轴时先打印出来。

**材质：在能烘焙的范围内做出层次。**

- **按真实材质分类，每类有明显差异。** 皮肤、布料偏哑光（roughness 0.7~0.9）；皮革、甲壳、漆面带一点清漆层（`MeshPhysicalMaterial` 的 clearcoat 0.3~0.8）；金属用 metalness 0.8~1，靠粗糙度区分新旧。注意 clearcoat 只保留在原版 GLB 里，烘焙后的 GLB 和 FBX 都会丢，不能只靠它出效果。
- **用顶点色画磨损和明暗。** 边缘、棱角提亮（金属磨损、布料起毛、甲片磨边），凹处和底面压暗，这些会烘进 basecolor，轮廓光一打边缘就亮起来。
- **环境光遮蔽烘进顶点色。** `def.shading` 会算部件之间的遮挡、压暗底面、给每个部件一点色调差，把发光材质和特效材质放进 `exclude`。乘完要夹紧到 0..1，否则 glTF 校验会报 `ACCESSOR_NON_CLAMPED`。
- **发光部件要带纹理。** 用 `emissiveMap`（噪声纹、刻线、屏幕图案），不要用纯色。自发光颜色分量控制在 1.6 以内，否则 bloom 会把它过曝成一片白。
- **控制亮色的比例。** 大面积用中低明度，最饱和、最亮的颜色只留给一两个焦点（眼睛、枪口火光、能量核心）。

**预览舞台：只影响截图和用户的第一印象，不进导出文件。**

- 用 `preview.stage` 选舞台：`studio`（默认，中性灰，适合人物、道具、机械），`volcanic`（暗红火山，适合火焰、熔岩、恶魔类）。其他题材可以照着 `stage.js` 加新舞台。好看的舞台大都是暗环境、低机位，背后一盏强轮廓光（约为主光的 2 倍）。
- 截图要包含焦点特写：用 `zoom`、`target` 对准脸、武器或其他焦点部位。

**面数：降分段，不砍部件。**

- 超预算时先降 `seg`、`rings`、`radial`、`perSeg` 和 `blob` 的 width/height，小刺、小零件用 `rings: 3` 就够了。
- `DoubleSide` 材质导出时面数会翻倍，开口的壳、披风、布片尤其要省。
- 想快速统计面数，用 Node 直接执行 `createCreature()`，按材质统计，比跑整条管线快得多。

**按题材落地（示例，不是清单）：**

| 题材 | 大件（剪影） | 中件（结构） | 小件（焦点） | 材质要点 |
|---|---|---|---|---|
| 持枪士兵 | 躯干和四肢比例、头盔、长枪 | 防弹背心、弹匣包、护膝、背包 | 脸部、手套、枪的瞄具和枪口 | 布料哑光，枪身金属磨边，背心带一点清漆 |
| 机甲 / 机器人 | 大块装甲外壳、肩甲、武器臂 | 关节液压杆、散热片、舱盖 | 传感器眼、指示灯、铆钉 | 漆面清漆 + 边缘露出金属，发光件带刻线 |
| 甲壳生物 | 几块带凹槽的大甲带、长角、背刺、尾锤 | 腿甲、颊板、膝刺 | 牙、眼、鼻孔 | 甲片清漆 + 边缘提亮，岩浆纹自发光 |
| 法师 / 布衣角色 | 长袍下摆、兜帽、法杖 | 腰带、披肩、护腕 | 脸、手、法杖顶端的宝石 | 布料哑光并有深浅分层，宝石自发光 |

`scute`（闭合的倒角板）和 `shell`（开口壳）都是通用形体，可以做甲片，也可以做护甲板、枪身零件、机甲外壳；题材用不上就不调用。

## 6. 自检

- `npm start` 打开预览，逐个按数字键看动画；`npm run shoot` 产出截图交给用户看。
- 导出时报 `checkBones/facing name unknown bones`：骨骼名写错了。
- 预览页报 `material "x" is not defined`：`part`/`skin` 用了 `materials` 里没有的 key。
- 腿抖动或翻转：`pole` 方向和膝盖实际弯向相反，或目标点超出 `upperLen + lowerLen`（会被夹紧，表现为腿伸直）。
- 截图工具超时但看不到原因：在 Node 里直接 `import` creature.js 并调用 `createCreature()` 和 `rig.finalize(def)`，就能拿到完整的报错堆栈。
