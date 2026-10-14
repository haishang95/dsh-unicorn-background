# dsh-unicorn-background

**v2.0.0** · 给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）网页界面加一张自定义背景图，并附一个可视化设置面板：换图、多图切换、上传、透明度与磨砂模糊实时可调；v2 新增对话文字区上的**毛玻璃阅读带**。

> 这是一个标准 DSH bundle 插件：宿主半区对外提供图片与配置接口，客户端半区负责绘制与设置面板。

## 功能

| 功能 | 说明 |
| --- | --- |
| 背景图 | 任意图片作为界面背景；内置一张，可上传多张随时切换、删除 |
| 磨砂玻璃 | 侧边栏 / 对话栏 / 内容层各自可调透明度（0–100%），另有背景模糊（0–60px）与饱和度 |
| 阅读带（v2 新增） | 在对话左右两条可拉伸边界之间铺一层毛玻璃带，宽度随拖动自动变化；可调宽度 / 不透明度 / 模糊 / 玻璃颜色，还能**从当前背景图提取主色调** |
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

### 阅读带（v2）

面板里的「文字区毛玻璃带」一节：

1. 勾选**启用**；
2. 拖**带子宽度**（20–150%）、**不透明度**（0–100%）、**毛玻璃模糊**（0–60px）；
3. **玻璃颜色**默认跟随主题底色，也可以手选，或点**从背景中提取**让它采样当前壁纸、写入选色器。

两点要知道：

- 宽度以**文字列**为基准（100% 即你习惯的那条边界宽度的 105%），带子两边始终贴着对话的两条可拉伸边界，拖边界它跟着变宽变窄，不需要任何脚本去量。
- 启用带子后，**对话栏只保留底色、不再叠自己的 `backdrop-filter`**。想「只磨砂文字区」，把上面的「对话栏」拉到 0% 即可。

## 设置项

### 宿主配置（写在 `$DSH_HOME/user-background/config.json`）

| 键 | 默认 | 含义 |
| --- | --- | --- |
| `enabled` | `true` | 背景总开关 |
| `image` | `default` | 当前壁纸；`default` 表示包内内置图，其余是上传后生成的文件名 |
| `sidebar` | 20 | 侧边栏不透明度（%） |
| `center` | 60 | 对话栏不透明度（%） |
| `panel` | 100 | 内容层（卡片）不透明度（%） |
| `blur` | 0 | 背景模糊半径（px） |
| `saturate` | 160 | 透过来的颜色饱和度（%） |
| `anchor` | `bl` | 图标初始角落：`tl` / `tr` / `bl` / `br` |

### 浏览器侧（存在 `localStorage`，不写入配置）

| 键 | 默认 | 含义 |
| --- | --- | --- |
| `dsh-user-background/button` | 无 | 图标被拖到哪儿（`{x, y}`），没有则用 `anchor` 角 |
| `dsh-user-background/defaults` | 无 | 「设为默认」记下的那套外观 |
| `dsh-user-background/band` | 见下 | 阅读带：`{enabled:false, width:100, opacity:58, blur:20, color:"", base:2}`；`color` 为空表示跟随主题底色 |

> 阅读带刻意只存在 `localStorage`：宿主半区不能热重载，加配置键会让整个功能都等到重启之后才生效。它默认关闭，所以不启用时旧的列磨砂行为与本插件 1.x 完全一致。
>
> `base` 是宽度的刻度版本号。1.x → 2.0 之间宽度基准从「100% = 文字列宽」改成「100% = 文字列宽的 105%」，读到没有 `base` 标记的旧记录时会**除以 1.05 迁移一次**，画面宽度不变、只是滑条读数重新对齐。

## 实现要点

- **为什么 token 覆盖要带 `!important`**：DSH 主题呈现器把解析后的 `--dsw-alias-*` token 以**内联**方式写在 `<body>` 上，作者样式表的重要声明才能压过普通内联声明。
- **为什么要覆盖 `--dsw-specific-sidebar-fill`**：Windows 标题栏形态下，应用框架与侧边栏画的是这个 token，而不是 `--dsw-alias-bg-base`；只改后者背景图会被整块盖住。
- **为什么缩略图要按名字取图**：`/image.jpg` 默认返回"当前选中"的图；带上 `?name=` 才能一格一图，否则所有预览都显示同一张（旧宿主没有这个能力时，非选中项退化成文件名文本，不假装有预览）。
- **重绘前先摘掉样式表**：否则会读到自己上一轮的输出，把半透明层层叠加，越重绘越透。
- **阅读带为什么挂在 frame 的 `::before` 上**：DSH 用 `max-width:var(--dsh-chat-content-width)` 给消息列定宽，拖边界写的就是这个变量。给「最近的、继承了该变量的定位祖先」——也就是带 `_root` 子节点的 `_frame`——加伪元素，用 `calc(50% - 宽度/2)` 就能精确落在文字列上，拖动时自动跟随。写成 `[class*="_frame"]:has(> [class*="_root"])::before`，靠局部类名而不是构建哈希，抵抗样式重编译。
- **为什么带子一开，对话栏就不能留 `backdrop-filter`**：元素一旦有 `backdrop-filter` 就成为后代的 **backdrop root**，后代只能磨到自己内部画的东西。对话栏是带子的祖先，它留着自己的 filter（哪怕 `blur(0px)` 什么都不画）就会把带子的毛玻璃整片遮掉——所以开启时那一层改用纯底色（`tint`）。
- **提取主色调为什么取「最饱和」而不是「最常见」**：最常见的色桶通常是纸面底色（近白），拿它调玻璃和「跟随主题」几乎没区别。只在占比过线（最高桶的 25%）的色桶里挑饱和度最高的，结果才读得出颜色、又确实出自图片本身。

## 诊断

客户端每次绘制都会把状态 POST 到 `GET /dsh-user-background/state`，面板出错时也会把栈送到同一个地方：

```powershell
Invoke-RestMethod http://127.0.0.1:<port>/dsh-user-background/state
```

`report` 里含 `applied / enabled / image / tags / panel / scheme / sidebar / center / band / bandFrame / bandVar / bandBox / bandBlockers`——带子不显示时先看 `bandFrame`（frame 找没找到）与 `bandBlockers`（哪一层祖先把 backdrop 挡住了）。浏览器控制台里 `window.__dshUserBackground` 也可用，含 `dispose()`。

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
│   └── client.js         客户端半区：加载浏览器脚本（改 wallpaper.js 时同步 bump 其 VERSION）
├── assets/
│   ├── wallpaper.js      浏览器半区：绘制 + 设置面板 + 阅读带
│   └── background.jpg    内置壁纸
├── README.md
└── LICENSE
```

数据目录：`$DSH_HOME/user-background/`（`config.json` 与 `images/`）。

## 兼容性

- 依赖 DSH 的客户端模块机制（`dsh.client`）与 `webServer` 服务；
- 主动覆盖的主题 token 若在未来的 DSH 版本中改名，磨砂层会退化为不透明，背景图本身不受影响；
- 列选择器与阅读带都用了 `[class*="_sidebarCol"]` / `[class*="_frame"]:has(> [class*="_root"])` 这类**局部名匹配**而非写死构建哈希，以抵抗样式重编译；
- 浏览器半区每次请求都重新读取并注入，改完 `assets/wallpaper.js` **只需刷新页面**；构造函数里改了注入地址时要同步 `lib/client.js` 的 `VERSION`，否则已开页面会拿到旧脚本。

## 更新记录

### 2.0.0

- 新增**阅读带**：对话两条可拉伸边界之间的可调毛玻璃带（宽度 / 不透明度 / 模糊 / 颜色），带「从背景中提取主色调」；
- 阅读带开启时对话栏改用纯底色，避免自家 `backdrop-filter` 变成 backdrop root 把带子的模糊遮掉；
- 宽度刻度假定为「100% = 文字列宽的 105%」，旧记录自动迁移；
- 版本号提升到 2.0.0。

### 1.0.0

- 首个版本：背景图、多图切换与上传、三列透明度与磨砂模糊、可拖动设置面板、「设为默认 / 恢复默认」。

## 许可

代码以 [MIT](LICENSE) 发布。**`assets/` 下的美术素材不在 MIT 覆盖范围内** —— 它仅随包分发、供本插件运行使用，不授予再许可；如果你要公开发布，请自行确认该图片的授权，或替换成你有权分发的图片。
