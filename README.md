# Snapworth · 资产复盘

每月 3 分钟，看清个人资产全貌。

🔗 **在线预览**：<https://jh13531.github.io/snapworth/>（无需安装，浏览器直接打开即可试用，数据仅保存在本地浏览器）

Snapworth 是一款**本地优先、无需服务器**的个人资产记账 PWA：以「月度快照」方式记录各账户的资产与负债余额，自动生成净资产趋势、资金流向、资产负债率与两月对比，帮助你用复盘的方式管理财富。

## 功能特性

- **月度快照记账**：每月只需录入各账户余额，不追踪逐笔交易，3 分钟完成
- **账户与子账户**：支持资产/负债分类、自定义分类、图标颜色、账户归档
- **总览仪表盘**：净资产趋势（近 12 月按自然月区间）、资产构成饼图、关键指标
- **分析页**：资金流向桑基图（资产/负债视图）、分类趋势、环比变动排行、资产负债率、本月总结，支持按分类/账户筛选联动
- **两月对比**：任意两个月的净资产/资产/负债变化、分类增减榜、区间年化增速（CAGR，附计算公式）
- **月度复盘**：每月记账后写下总结，自动计算负债率与环比变化
- **多货币支持**：内置多种货币，汇率可一键获取（欧洲央行 ECB 数据 + 公共 API 兜底，仅点击时联网）
- **目标预测**：基于历史增速的净资产趋势预测
- **隐私模式**：一键隐藏所有金额（比率/百分比保持可见）
- **数据导入导出**：支持 CSV / Excel 导入导出
- **加密备份**：`.snapvault` 备份文件采用信封加密（Argon2id + AES-256-GCM），支持密码 / 恢复码 / 密钥文件三种解锁方式
- **自动备份**：授权本地文件夹后（File System Access API），每次记账自动写入加密备份，配合云盘文件夹即可多设备同步
- **PWA**：可安装到桌面/主屏幕，离线可用，移动端优先、桌面端适配
- **中英文双语**：内置 i18n，可手动切换

## 隐私与安全

- **完全本地**：所有数据只存于浏览器 IndexedDB，无账号、无服务器、无任何分析/埋点 SDK
- **唯一网络请求**：用户主动点击「获取汇率」时，向欧洲央行及公共汇率 API 请求汇率数据，不上传任何数据
- **CSP 安全策略**：生产环境通过 Content-Security-Policy 限制脚本与网络来源，禁止内联脚本
- **备份端到端加密**：备份密钥在客户端由密码经 Argon2id 派生，数据以 AES-256-GCM 加密，AAD 绑定账本 ID 与版本号，防止密文替换/回滚

## 技术栈

React 18 · TypeScript · Vite 7 · Tailwind CSS · ECharts 6 · Dexie (IndexedDB) · Zustand · decimal.js · hash-wasm · PapaParse · SheetJS · date-fns · dnd-kit · react-router · vite-plugin-pwa

## 快速开始

环境要求：Node.js 18+（推荐 20/22）

```bash
npm install
npm run dev
```

访问 http://localhost:5174 （开发服务器固定端口）。

## 最终用户本地运行

最终用户无需安装依赖或构建：到仓库的 **Releases** 页面下载最新的 `snapworth-vX.X.X.zip`，解压后双击启动脚本即可（脚本会用本机 Python 或 Node 把 `dist/` 起在 http://localhost:5174 ，仅监听本机回环地址）：

- Windows：双击 `启动资产复盘.bat`
- Linux / macOS：运行 `./启动资产复盘.sh`

要求：系统装有 Python 3 或 Node.js 任一即可。

> 开发者发布新版本：推送 tag 即可自动构建并发布安装包，例如 `git tag v0.1.1 && git push origin v0.1.1`（见 `.github/workflows/release.yml`）。

## 常用脚本

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动开发服务器（端口 5174） |
| `npm run build` | 类型检查 + 生产构建（输出到 `dist/`） |
| `npm run preview` | 本地预览生产构建 |
| `npm test` | 运行单元测试（Vitest） |
| `npm run lint` | ESLint 检查 |
| `npx playwright test` | 端到端测试（需先 `npx playwright install chromium`） |

## 部署

构建产物为纯静态文件，可部署到任意静态托管（GitHub Pages、Netlify、Vercel、Nginx 等）：

```bash
npm run build
# 将 dist/ 目录发布即可
```

## 数据与备份说明

- 数据存储在浏览器 IndexedDB 中，**清除浏览器数据会导致丢失**，请定期使用「设置 → 导出加密备份」
- `.snapvault` / `.snapkey` 备份文件与 `backups/` 目录均已在 `.gitignore` 中忽略
- `test-data/` 中的 TSV/XLSX 是导入功能的**合成测试夹具**（虚构数据），不包含真实个人财务信息

## License

[MIT](LICENSE)

## GitHub Pages 部署

仓库内置 Actions 工作流 `.github/workflows/deploy.yml`：推送到 `main` 分支即自动构建并发布到 GitHub Pages。

首次使用：
1. 在 GitHub 建仓库后推送代码
2. 仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**
3. 之后每次 push 到 `main` 都会自动更新站点，地址为 `https://<用户名>.github.io/snapworth/`

> 注意：工作流中构建参数 `--base=/snapworth/` 与仓库名对应；如果仓库不叫 `snapworth`，需同步修改工作流里的 `--base=/<仓库名>/`。
