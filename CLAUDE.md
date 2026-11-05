# 模组拼合实验室（ModePuzzle）

《深空当铺：可能是偷的》（Probably Stolen）模组舱布局优化器。纯浏览器、无后端。完整规则见 `README.md`，需求演变与已纠正的误解见 `docs/gpt-history.md`。

## 常用命令

- 测试：`npm test`
- 本地运行：`python -m http.server 5173 --directory src`，打开 http://127.0.0.1:5173（8080 端口在本机被其他程序占用）
- 离线单文件：`python scripts/build.py` → `dist/module-layout-offline.html`
- 刷新字体子集：`python scripts/build_fonts.py --wdxl <上游 WDXLLubrifontSC-Regular.ttf>`（改动界面文字后要跑）
- Windows 桌面版：`python scripts/build_exe.py` → `release/`

## 约定

- 不写魔法数字：规则、上限、搜索参数、界面常量放 `src/config/`；HTML 中的数字用 `data-rule` / `data-tolerance` 等占位由 app.js 填充。
- **不得再分发任何游戏素材**（贴图、音效、本地化表、源码）——官方 Discord 的模组行为准则明令禁止。仓库与构建产物里只能有：游戏名词（种类/词条名）、规则数值与形状、原创像素画、自写的说明文字、开源字体。
- 模组种类、数值与合法形状以游戏为准（`src/config/catalog.js`）；游戏不存在的种类/形状组合用占位样式。
- 像素画是原创的，由代码生成（`src/render/module-art.js`）。不得照着或基于官方贴图修改重绘，也不要引入位图文件。
- 游戏目录只读访问；游戏可能正在运行，不要结束其进程或写入其目录。
- 计分改动须同步：计分器、搜索增量、安全上下界，并补测试。
- 不得破坏用户存档：localStorage 键、schema version 1、旧字段迁移逻辑保持兼容；`kind` 为可选字段。
