# 北境：序章（暂名）

浏览器里的北地奇幻开场：囚车 → 处决 → 巨龙袭城 → 要塞逃生 → 走出洞穴。
地名、人名、台词均为原创；第三方美术与音频只用 CC0 / CC-BY / CC-BY-SA 资源，并在“制作人员”页署名。

当前进度：**M1**，包括加载与缓存框架、主菜单和囚车段。

## 快速开始

```bash
npm install
npm run fetch-sources   # 下载第三方源资源到 assets-src/（约 600 MB，可重复执行，已有文件会跳过）
npm run build-assets    # 生成 public/data/*（内容哈希命名）与 public/manifest.json
npm run build           # 类型检查 + Vite 打包到 dist/（含 Service Worker）
npm run preview         # 本地静态服务器 http://localhost:4173（brotli，可加 --mbps 20 模拟带宽）
```

- 源资源来自 Poly Haven（贴图、模型、HDRI）、Quaternius 的 itch.io 免费包（人物、服装、动画）、0 A.D.（马）、OpenGameArt 和 Freesound（音乐、音效）。授权见 `tools/credits-extra.mjs` 和各目录里保留的原始授权文件。
- `assets-src/`、`public/data/`、`public/manifest.json` 都是生成物，不入库。
- 开发时用 `npm run dev`（不启用 Service Worker）。
- 调试参数（拼在 URL 后）：
  - `?webgl`：强制使用 WebGL2。
  - `?debug`：显示 fps、draw call、下载速度，并暴露 `window.__game`。
  - `?debug&timescale=20`：加速剧情。

## 技术栈

- 渲染：Babylon.js 9，按模块路径引入。优先 WebGPU，不支持时回退 WebGL2。
  - WebGPU 下全部使用 WGSL 着色器，不会去拉 glslang/tint。
- 工程：TypeScript 和 Vite，代码分割。首屏只加载约 0.37 MB（brotli）的页面资源。
- 资源：
  - 模型：glTF/GLB，经 meshopt 压缩和量化。
  - 贴图：KTX2（Basis ETC1S）。
  - 音频：Opus，AAC 备用。
  - 所有解码器（KTX2 转码器、meshopt、zstd）都放在本地 `public/decoders`，不依赖 CDN，可离线运行。
- 物理（Jolt）从 M2 开始接入。囚车段没有物理交互。

## 加载与缓存

```
main thread                         asset worker (src/core/assets/asset.worker.ts)
───────────                         ─────────────────────────────────────────────
AssetClient.get(id) ──postMessage──▶ 优先级队列（并发 6）
                                      1. 有人在等 / 当前段落开局包
                                      2. 下一段落
                                      3. 离玩家 160 m 内（manifest pos）
                                      4. 之后的段落   5. 已经过的段落（补全离线缓存）
                                    fetch → SHA-256 校验 → IndexedDB（键 = 内容哈希）
◀── transfer ArrayBuffer ────────── LRU 淘汰（保护当前/下一段落）、过期版本清理
```

- `manifest.json` 中每一项记录 ID、URL、SHA-256、大小、段落、优先级，可选记录世界坐标，并标明是否属于开局包。
- 网络、IndexedDB 读写和哈希校验都在 Worker 里完成。KTX2 转码用 Babylon 的 Worker 池，meshopt 解压用独立 Worker，音频由浏览器在后台线程解码。
- 下载调度：
  - 有紧急资源排队时，后台下载最多占 2 个连接，必要时会被中断，让紧急资源先下。
  - 玩家离开某个段落后，该段落还在进行的后台下载会被取消。
- 启动时调用 `navigator.storage.persist()`。设置页显示缓存占用，并提供“清除缓存”按钮。
- Service Worker 只缓存应用外壳（HTML、JS、解码器、manifest），游戏数据走 IndexedDB。
- 开局包：每个段落里非 `optional` 的资源。囚车段开局包约 **8.0 MB**（brotli）。悬崖、巨石、背景音乐等在乘车途中流式下载。
  - 晚到的散布物件只在离相机 70 m 以外出现，不会当面弹出。
- 玩家停在菜单时，整个囚车场景就在后台搭好并编译着色器，点“新游戏”后只需要淡入淡出。
- 兜底：若小镇资源没赶上，车队会在城外检查点停下等待，只在角落显示加载提示。

## 囚车段内容

- 程序生成的 1.8 km × 1.8 km 地形，按距离道路分级精度，带裙边防止接缝。
  - 草地、泥土、岩石（三平面投影）、道路、积雪五层，按高度混合，GLSL 和 WGSL 各一份。
- 用 Poly Haven 树枝图集合成的冷杉，分三级 LOD：完整模型、简化模型、impostor。用 thin instance 绘制，带风摆动。
- 散布的岩石、蕨类、树桩、倒木和悬崖。
- 两辆马车组成车队。车轮转动，有路面颠簸；马的步态与车速同步。前车旁有两名步行押送兵。
- 第一人称坐姿镜头，只能转头，支持鼠标和手柄右摇杆。
- 原创对白 26 句，按时间和剩余路程触发，有字幕。说话人会转头看向对方。
- 抵达边境小镇“雾门镇”：城墙、拱门、圆塔和木屋。到达后显示段落结束画面。
- 3D 空间音效：马蹄声、车轮吱呀声、森林环境声。背景音乐支持平静、紧张、战斗三种状态切换。
- 级联阴影、HDR 环境光、指数雾、ACES 色调映射与调色、泛光，画质分低、中、高三档。

## 测试

```bash
node tests/e2e.mjs              # 20 Mbps 限速下的验收（首次 / 二次打开 / 离线打通）
node tests/smoke.mjs            # 截图冒烟测试（需先 npm run preview）
WEBGPU=1 node tests/probe.mjs <steps.mjs>   # 用 WebGPU 跑调试脚本
```

最近一次验收（容器内无头 Chromium，**纯软件渲染 SwiftShader**，约 1 fps）：

| 项目 | 目标 | 结果 |
|---|---|---|
| 首次打开菜单可操作 | ≤ 3 s | 0.97 s ✅ |
| 首屏体积 | ≤ 2.5 MB | 0.37 MB ✅ |
| 点“新游戏”后进入囚车段 | ≤ 10 s | 15.5 s ❌（开局包约 2 s 下完，其余是软件渲染下的解析、上传和着色器编译） |
| 二次打开菜单可操作 | ≤ 1 s | 0.14 s ✅ |
| 断网后打通囚车段 | 可完成 | ✅ |
| WebGPU 路径 | 可运行 | ✅（不访问外部 CDN） |

帧率、显存和 draw call 的指标需要在真实 GPU 上测。软件渲染下主画面每帧约 150–180 个 draw call。

## 已知限制

- 人物来自 Quaternius 的 CC0 素材，风格偏半写实，和“写实中世纪”有差距。更写实的人物需要 Mixamo/Sketchfab 账号才能获取，后续可以替换。
- 还没有配音，只有字幕。没有口型。
- 还没有在真实 GPU 上测过“10 秒进入囚车段”和第 7 节的帧率指标。
- 乘车途中搭建小镇会把实例化分摊到多帧。每块实例化的耗时还没在真机上测量。
