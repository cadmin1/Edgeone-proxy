# EdgeOne Proxy（多平台代理）

一个轻量 HTTP 代理，统一实现：**防盗链绕过（referer/origin 改写）、8 秒上游超时、默认下载响应头、HTML/CSS 链接改写（高级代理）**。当前保留三个平台版本：

| 平台 | 类型 | 目录 | 部署形态 |
|------|------|------|----------|
| 阿里云 | 函数计算 FC | `aliyun-fc/` | 事件函数 + HTTP 触发器，入口 `index.handler` |
| 腾讯云 | 边缘计算 EdgeOne Pages | `functions/` | 边缘函数，入口 `onRequest(context)` |
| 腾讯云 | 函数计算 SCF（Web 函数） | `tencent-scf-web/` | HTTP Server :9000 + 函数 URL，`scf_bootstrap` 启动 |

> 请仅在合规、授权和研究场景中使用本项目。不要用于绕过访问控制、未授权抓取、攻击测试或其他违反目标站点条款与当地法律法规的用途。

## 统一功能

- **标准代理** `/proxy?url=...`：透传（接口、图片、静态资源、下载）
- **高级代理** `/advanced-proxy?url=...`：额外做 HTML/CSS 链接改写（连续浏览页面）
- **防盗链**：客户端携带 referer/origin 时改写为目标站点自身
- **超时兜底**：上游 8 秒无响应返回 504（带原因）
- **响应头过滤**：黑名单（content-length、transfer-encoding、set-cookie 等）+ CORS 注入

## 下载 / 内联控制（三版一致）

| 请求参数 | 响应头 | 效果 |
|----------|--------|------|
| （默认） | `Content-Disposition: attachment` | 浏览器下载文件 |
| `&inline=1` | `Content-Disposition: inline` | 浏览器内联显示 |
| `&filename=xxx` | `attachment; filename="xxx"` | 下载并指定文件名 |

错误响应（400/404/500/504）不带下载头，保持可读文本。

## 部署

### 阿里云 FC（`aliyun-fc/`）

1. 函数计算 FC → 服务及函数 → 创建「事件函数」：Node.js 18、入口 `index.handler`、256MB、超时 60s；**高级配置 → 请求处理程序 = 处理 HTTP 请求**；
2. 上传 `aliyun-fc/index.js + package.json`（zip）；
3. 创建 **HTTP 触发器**（免鉴权）→ 访问 `https://{fc域名}/proxy?url=...`。

⚠️ FC 默认域名强制 `Content-Disposition: attachment`（浏览器直接访问会下载）；`?inline=1` 在默认域名下仍可能被强制下载，需绑定**自定义域名**才能内联显示。图片 `<img>` / fetch 场景不受影响。

### 腾讯 EdgeOne Pages（`functions/`）

1. EdgeOne Pages 控制台 → 项目（本仓库）→ 构建部署；
2. 访问 `https://{你的域名}/proxy?url=...`。

### 腾讯 SCF Web 函数（`tencent-scf-web/`）

1. 云函数 SCF → 新建 → **Web 函数（HTTP 触发函数）** → Nodejs 18.15、内存 256MB、超时 60s；
2. 上传 zip（`index.js + scf_bootstrap + package.json`，bootstrap 已设 755 权限）；
3. 启用**函数 URL**（免鉴权）→ 访问 `https://{你的函数URL}/proxy?url=...`。

> scf_bootstrap 内容：`#!/bin/bash` + `export PORT=9000` + `/var/lang/node18/bin/node index.js`（若运行时为 16.13 改 `node16`）。上传报 405 时改用控制台「高级配置 → 启动命令」粘贴。

## 本地测试

```bash
node test-edgeone.mjs    # EdgeOne 边缘函数
node test-fc.cjs         # 阿里 FC
node test-tencent-web.cjs  # 腾讯 SCF Web 函数
```

## 常见问题

- **502 / ERR_INVALID_RESPONSE（边缘版访问 TMDB 等被墙站点）**：大陆边缘节点无法回源被墙域名，属网络问题；请用函数版（FC/SCF 回源可达）或挂代理。
- **OverSize**：目标资源超过边缘函数响应体上限；大文件请用函数版。
- **下载 vs 显示**：默认下载；需要内联显示加 `&inline=1`。
