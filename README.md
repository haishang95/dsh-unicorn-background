# dsh-unicorn-background

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）网页界面加一张自定义背景图，并附一个可视化设置面板：换图、多图切换、上传、透明度与磨砂模糊实时可调。

> 这是一个标准 DSH bundle 插件：宿主半区对外提供图片与配置接口，客户端半区负责绘制与设置面板。

## 功能

| 功能 | 说明 |
| --- | --- |
| 背景图 | 任意图片作为界面背景；内置一张，可上传多张随时切换、删除 |
| 磨砂玻璃 | 侧边栏 / 对话栏 / 内容层各自可调透明度（0–100%），另有背景模糊（0–60px）与饱和度 |
| 设置面板 | 圆角磨砂面板，点击图标开合；**图标可任意拖动**，位置记在 `localStorage` 并跨重启保留 |
| 收起 | 点击面板外侧自动收起，`Esc` 同样收起 |
| 设为默认 | 把当前这套外观记成「恢复默认」的目标，之后随时一键回到该状态 |
| 沉浸感 | 深浅色主题各自取色，切换主题时自动重新推导，不会串色 |

所有改动**即时生效**并写入配置文件，无需重启。

## 安装

插件目录里 `package.json`、`cordis.patch.yml`、`lib/`、`assets/` 齐备，用 DSH 自带的包管理器装即可。

**从本地目录安装（开发 / 自用）：**

```powershell
# 把本目录放到一个以后不会移动的位置，例如 D:\Plugins\dsh-unicorn-background
dsh plugin --profile <profile> add link:D:\Plugins\dsh-unicorn-background
```

**从压缩包安装：** 先解压到一个固定目录（**要装的是包含 `package.json` 的那一层**，不要多套一层同名目录），再执行上面的 `add link:<该目录>`。

`<profile>` 一般是 `web`。官方桌面客户端读的是 `desktop` profile，而该 profile 由 Electron 应用独占管理，命令行按设计会拒绝 —— 桌面端请在会话里让 DSH 自己安装，或按该 profile 的等价手工路径处理。

安装后**重启一次客户端**（宿主半区不能热重载），网页端再按 `Ctrl+F5`。

## 使用

界面左下角（默认）会出现一个半透明的小图片图标：

- **拖动图标** → 移动位置；**点一下图标** → 开合面板
- 面板里可以换图、上传新图、拖滑块调透明度与模糊
- 点面板外侧或按 `Esc` 收起
- 想改「恢复默认」的目标，点面板底部的**设为默认**

## 设置项

| 键 | 默认 | 含义 |
| --- | --- | --- |
| `enabled` | `true` | 背景总开关 |
| `image` | `default` | 当前壁纸；`default` 表示包内内置图 |
| `sidebar` | 74 | 侧边栏不透明度（%） |
| `center` | 66 | 对话栏不透明度（%） |
| `panel` | 78 | 内容层（卡片）不透明度（%） |
| `blur` | 20 | 背景模糊半径（px） |
| `saturate` | 160 | 透过来的颜色饱和度（%） |
| `anchor` | `bl` | 图标初始角落：`tl` / `tr` / `bl` / `br` |

面板拖动位置与「设为默认」的基线存在浏览器的 `localStorage`，不写入配置。

## 实现要点

- **为什么 token 覆盖要带 `!important`**：DSH 主题呈现器把解析后的 `--dsw-alias-*` token 以**内联**方式写在 `<body>` 上，作者样式表的重要声明才能压过普通内联声明。
- **为什么要覆盖 `--dsw-specific-sidebar-fill`**：Windows 标题栏形态下，应用框架与侧边栏画的是这个 token，而不是 `--dsw-alias-bg-base`；只改后者背景图会被整块盖住。
- **为什么缩略图要按名字取图**：`/image.jpg` 返回"当前选中"的图，如果每格都用它，所有预览都会显示同一张。
- **重绘前先摘掉样式表**：否则会读到自己上一轮的输出，把半透明层层叠加，越重绘越透。

## 卸载

```powershell
dsh plugin --profile <profile> remove dsh-unicorn-background
```

## 目录

```text
dsh-unicorn-background/
├── package.json          DSH bundle 元数据（dsh.bundle.patch / dsh.client）
├── cordis.patch.yml      挂载声明
├── lib/
│   ├── index.js          宿主半区：图片与配置接口
│   └── client.js         客户端半区：加载浏览器脚本
├── assets/
│   ├── wallpaper.js      浏览器半区：绘制 + 设置面板
│   └── background.jpg    内置壁纸
├── README.md
└── LICENSE
```

数据目录：`$DSH_HOME/user-background/`（`config.json` 与 `images/`）。

## 兼容性

- 依赖 DSH 的客户端模块机制（`dsh.client`）与 `webServer` 服务；
- 主动覆盖的主题 token 若在未来的 DSH 版本中改名，磨砂层会退化为不透明，背景图本身不受影响；
- 列选择器用 `[class*="_sidebarCol"]` 这类**局部名匹配**而非写死构建哈希，以抵抗样式重编译。

## 许可

代码以 [MIT](LICENSE) 发布。**`assets/` 下的美术素材不在 MIT 覆盖范围内** —— 它仅随包分发、供本插件运行使用，不授予再许可；如果你要公开发布，请自行确认该图片的授权，或替换成你有权分发的图片。
