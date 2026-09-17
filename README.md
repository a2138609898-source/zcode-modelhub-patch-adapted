# zcode-modelhub-patch-adapted

ZCode Desktop **3.12.3.7463** 适配版「模型管理」补丁。

> 本项目是 [CSSZYF/zcode-modelhub-patch](https://github.com/CSSZYF/zcode-modelhub-patch) v1.2.1 的**非官方适配分支**（MIT License）。
> 原版补丁只支持旧版 ZCode；ZCode 3.12.3 重构了模型供应商设置页后，原版锚点全部失配。本仓库重写了渲染层注入代码，使其在新架构上工作。

## 功能（与原版 v1.2.1 对齐）

- **拉取模型**：在 添加/编辑渠道 页一键拉取任意 OpenAI 兼容端点的全量模型列表，弹窗勾选后批量添加
- **方言感知回退**：anthropic 渠道优先 `/v1/models`，OpenAI 系优先 `/models`，gemini 走 `v1beta`
- **按方言认证**：anthropic 自动附 `x-api-key`，gemini 走 `x-goog-api-key`
- **视觉能力实测**：发送 1×1 测试图用真实响应判定识图能力（仅作参考标记，不写入模型配置）
- **请求头模拟**：Claude (claude-cli) / Codex (codex_cli_rs) 预设请求头，写入渠道的 `config.api.headers`（3.12.x 引擎原生支持该字段）
- 通过主进程 IPC 发起对端点的请求（绕过 CORS）

## 相比原版 v1.2.1 的改动（适配 3.12.3）

| 项目 | 原版 | 本适配版 |
|---|---|---|
| 渲染层入口 | `out/renderer/assets/styles-DyAcaLKy.js` | `out/renderer/assets/styles-ou2or4Yg.js` |
| 注入锚点 | 旧版自定义渠道表单（`customModels` / `QPt`） | 新版 `M5` 渠道表单内 `vRt` 模型列表调用点（运行时定位+唯一性校验） |
| 添加模型方式 | 写入表单 `customModels` 数组 | 调用新版原生 `onAddPersonalModel`（`useRecommendedConfig=true`），与手动添加模型同一条持久化路径 |
| 请求头存储 | 渠道 `headers` 字段 | `config.api.headers`（3.12.x 引擎原生读取；新版自动保存为展开合并，字段不会被剥离） |
| 按钮位置 | 「添加渠道」弹窗内 | 渠道详情页模型列表正上方 |
| preload / 主进程 | — | 未改动（原版锚点在 3.12.3 中仍然匹配） |

原版中依赖旧 UI 结构的两个特性未保留：删除持久化（`zcode.deletedModels`）与 sticky-headers 锚点（新版保存逻辑已天然保留未知 api 字段，不再需要）。

## 安装

要求：Windows + Node.js（任意 LTS 版本）+ ZCode Desktop 3.12.3.7463。

```bat
node patch-core-adapted.js "ZCode安装目录下的resources文件夹"
```

例如（按用户安装的默认路径）：

```bat
node patch-core-adapted.js "C:\Users\<你的用户名>\AppData\Local\Programs\ZCode\resources"
```

- 脚本先在内存中校验锚点，不匹配会明确报错并放弃，**不会损坏原文件**
- 安装前自动备份为 `app.asar.modelhub-backup`
- 若 ZCode 正在运行，最后一步原子替换会因文件占用失败（EPERM）——这是预期行为：此时补丁成品已生成在 `app.asar.modelhub-tmp`，**完全退出 ZCode 后**用任意方式把它改名为 `app.asar` 即可，或重跑一次脚本
- 安装成功后重启 ZCode：设置 → 模型供应商 → 点选渠道 → 模型列表上方即可看到「拉取模型」「请求头模拟」按钮

`一键完成安装-备用.cmd` / `还原补丁.cmd` 是作者个人机器上用的辅助脚本（内含硬编码路径，请自行修改后使用）。

## 还原

```bat
node patch-core-adapted.js "ZCode安装目录下的resources文件夹" --restore
```

## 已知限制

- 仅适配 **ZCode Desktop 3.12.3.7463**（渲染层为 Vite 构建，带内容哈希的文件名与压缩代码锚点随版本变化）
- ZCode 自动更新会覆盖补丁，更新后需要重新安装；若大版本结构再变，需重新校对锚点
- 视觉探测结果仅用于展示，模型能力字段由应用按推荐配置自行解析

## 免责声明

本项目为纯本地修改的非官方第三方补丁，与 ZCode 官方无关。修改的是你自己机器上的本地文件，安装前已自动备份，风险自担。

## 许可证

MIT。基于 [CSSZYF/zcode-modelhub-patch](https://github.com/CSSZYF/zcode-modelhub-patch) v1.2.1 修改，原项目作者 CSSZYF。详见 [LICENSE](LICENSE)。
