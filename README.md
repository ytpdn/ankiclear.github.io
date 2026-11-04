# 单词消消乐 Consumer Preview

这是一个无需构建工具的静态网页应用。解压后可直接部署到静态托管平台。

## 目录说明

- `index.html`：页面结构与各模块加载顺序。
- `js/data.js`：词库数据、文本解析与本地持久化。
- `js/storage.js`：IndexedDB、旧数据迁移与兼容回退。
- `js/audio.js`：音效加载与播放。
- `js/game.js`：卡片渲染、配对与动画。
- `js/app-core.js`：应用状态、配置和会话快照。
- `js/theme.js`：主题色与自定义背景。
- `js/screens.js`：欢迎页、首页与首次使用引导。
- `js/word-list.js`：词汇列表、搜索、排序、删除和导出。
- `js/learning-session.js`：每日队列、乱序、错词重试与学习结果。
- `js/settings.js`：设置与网页内弹窗。
- `js/import.js`：词库和学习记录导入。
- `js/events.js`：页面事件绑定。
- `js/main.js`：应用初始化入口。
- `algo.js`：间隔复习算法。
- `xlsx.js`：XLSX 读取与词汇识别。
- `css/`：按页面与职责拆分的样式文件；`loading.css` 为启动和导入遮罩。
- `images/`、`audio/`：本地图片和音频资源。
- `vendor/`：XLSX 解压、离线 OCR、本地美式 IPA 词典及其许可证。

## 维护约束

`index.html` 中 JavaScript 和 CSS 的加载顺序具有依赖关系。修改模块时应保持顺序，并在发布前回归测试词库导入、OCR、学习、错词复习、词表搜索、范围选择和设置保存。

## 大词库与导入保护

- 词汇列表每次显示 300 条，搜索和排序仍针对完整词库。
- CSV、TSV、TXT 最大读取 10MB，XLSX 最大读取 15MB。
- 未识别到有效中英文词汇时拒绝覆盖现有词库。
- 单词学习状态在短时间内合并保存，并在每组完成、页面隐藏或离开时立即写入。

## 本地数据存储

- IndexedDB 保存词库、单词学习状态、错词次数和自定义背景。
- localStorage 只保存主题、学习数量、当日统计和当前会话等小型配置。
- 第一次运行会自动迁移旧版 localStorage 数据；只有 IndexedDB 事务成功后才删除旧副本。
- IndexedDB 不可用时自动回退到旧存储方式，保证浏览器和 WebView 仍能启动。

学习算法和音频资源未调整。
