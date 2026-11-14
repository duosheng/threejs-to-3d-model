# 各引擎导入要点

目录：1 选哪个文件 · 2 Unity（已实测） · 3 Godot 4 · 4 Unreal 5 · 5 Cocos Creator · 6 Web · 7 通用注意事项

只有 Unity 2022.3 用模板里的 `unity/` 脚本做过逐帧骨骼比对；其余引擎是按官方导入器行为整理的说明，**未实测**。给用户交付时要按实际验证情况说明。

## 1. 选哪个文件

| 引擎 | 首选 | 备选 |
|---|---|---|
| Unity 2022+ | `<name>-baked.fbx`（自带导入器，无需插件） | `<name>-baked.glb` + glTFast |
| 团结引擎 | 同 Unity，**未实测** | — |
| Godot 4 | `<name>-baked.glb` | — |
| Unreal 5 | `<name>-baked.fbx` | `<name>-baked.glb`（5.1+ Interchange glTF） |
| Cocos Creator 3 | `<name>-baked.fbx` 或 `-baked.glb` | — |
| Three.js / Babylon / Web | `<name>.glb`（原版，清漆、顶点色效果最完整） | `-baked.glb`（更省、更兼容） |

## 2. Unity（已实测，2022.3.62f3c1）

自动化：`npm run unity`（检查）、`npm run unity:capture`（预览场景 + Play 截图）。手动导入时的设置：

- FBX：
  - Rig 选 **Generic**，Avatar 选 Create From This Model（不是 Humanoid）。
  - 勾 **Bake Axis Conversion**。
  - Animation Compression 选 **Off**；需要压缩时先确认误差可以接受。
  - Materials 里点 **Extract Textures**，再把 `*_normal` 的 Texture Type 改成 Normal map。
  - 动画片段按 manifest 的 `loop` 勾选 Loop Time，单次动画不勾。
  - 材质的 Smoothness = 1 − roughness，Metallic = metallic，Emission = 白色 × emissionStrength，数值取自 `manifest.baked.materials`。
- GLB（glTFast 6.14.1）：
  - 拖进 Assets 即可。
  - 多材质蒙皮在编辑器里可能报 `SortAndNormalizeBoneWeightsJob` 安全异常：导入时临时设 `JobsUtility.JobDebuggerEnabled = false`，玩家包没有这个检查。
  - glTFast 把所有片段都标成循环、60 fps，单次动画要在 Animator 里按单次处理。
- 模型朝 +Z，1 单位 = 1 米。行走动画是原地的，用 `meta.walkSpeed` 驱动根节点移动。
- 事件：`manifest.clips[].events` 的秒数可以写成 AnimationEvent，或在状态机里按 normalizedTime 判断。

## 3. Godot 4（未实测）

- 把 `<name>-baked.glb` 放进项目，自动导入为场景，包含 Skeleton3D + MeshInstance3D + AnimationPlayer。
- 循环：在 Import 面板的 Animation 页给循环动画设 Loop Mode = Linear（glTF 本身没有循环标记）。
- 朝向：Godot 的「前方」是 -Z，模型朝 +Z。需要时把根节点绕 Y 转 180°，或者在逻辑里按 +Z 处理。
- 自发光强度会读 `KHR_materials_emissive_strength`。

## 4. Unreal 5（未实测）

- FBX：
  - Import as Skeletal Mesh，勾 Import Animations。
  - Unreal 用厘米，导入器默认把米制 FBX 换算成 ×100，导入后核对一下尺寸（模型高度见 manifest 的 `bounds`）。
  - 如果朝向不对，在导入选项里调 Import Rotation（Yaw 90 或 −90）；Unreal 的前方是 +X。
- glTF：5.1 起的 Interchange 可以直接导入 GLB 骨骼动画，材质会转成 Unreal 的 PBR 材质。
- 粗糙度、自发光强度：FBX 不带这两项，在材质实例里按 `manifest.baked.materials` 补。

## 5. Cocos Creator 3（未实测）

- FBX、glTF 都能直接导入，生成 prefab + SkeletalAnimation 组件。
- 动画循环在动画剪辑资源上设 WrapMode。
- 手游注意面数和骨骼数（见 design-spec.md 的预算表）。可以用 Cocos 的 GPU 烘焙动画（Use Baked Animation）提升性能。

## 6. Web（Three.js / Babylon）

- 用原版 `<name>.glb`：`GLTFLoader` 加载后，按 `gltf.animations` 建 AnimationMixer。
- 单次动画：`action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true`。
- 呼吸灯等动态发光：按 `runtimeNotes` 在逐帧回调里改 `material.emissiveIntensity`。

## 7. 通用注意事项

- **单位与朝向**：米，+Y 向上，面朝 +Z（glTF 约定）。
- **帧率**：导出按 30 fps 逐帧采样，每帧都有关键帧，引擎端不要再做曲线简化。
- **IK**：已逐帧烘进骨骼旋转，引擎端不需要也不应该再加 IK（除非要做地形贴合，那是另一回事）。
- **骨骼名**：和 `manifest.bones` 一致，用来挂武器、特效或做命中判定。
- **自动化验证其他引擎**：照 `unity/` 的思路写：导入 `-baked` 文件 → 在 `reference-samples.json` 的时刻采样 checkBones → 和参考坐标做轴向映射比对 → 截图。做完才能说「已验证」。
