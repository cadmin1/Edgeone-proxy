# 腾讯云函数 SCF 代理版

将代理移植到**腾讯云函数（SCF，Serverless Cloud Function）**，事件函数 + **函数 URL（Function URL）**，Node.js 18+ 运行时，零依赖。

> ⚠️ **注意**：腾讯云 API 网关产品已于 2025-06-30 停止服务，API 网关触发器已不可用（2024-07-01 起禁止新建）。**请使用「函数 URL」**（SCF 3.0 内建 HTTP 端点，免费、无需备案、浏览器直接渲染页面）。

## 相比阿里 FC 的优势

- **函数 URL 不强制 `Content-Disposition: attachment`**，浏览器**直接渲染页面**，无需绑定自定义域名；
- 事件结构简单（`event.path` / `event.queryString`）；
- 免费额度充足（每月 40 万 GB-秒 + 400 万次调用），个人代理 0 成本。

## 功能

- 标准代理：`/proxy?url=...`（透传，适合接口、图片、静态资源）
- 高级代理：`/advanced-proxy?url=...`（HTML/CSS 链接改写）
- referer / origin 改写为目标站点（绕过防盗链 403）
- 响应头黑名单过滤 + CORS 注入
- 8 秒上游超时（超时返回 504 并带原因）
- 文本响应字符串返回；二进制（图片等）base64 + `isBase64Encoded`

## 部署步骤（函数 URL）

### 1. 创建函数

腾讯云控制台 → **云函数 SCF** → 函数服务 → **新建**：

- 创建方式：**空白函数**（事件函数）
- 运行环境：**Nodejs 18.15**（或更高）
- **执行方法：`index.main_handler`**
- 内存：256 MB，执行超时：60 秒

### 2. 上传代码

函数 → **函数代码** → 上传 zip（`index.js` + `package.json`）：

```bash
cd tencent-scf
zip -r proxy.zip index.js package.json
```

### 3. 启用函数 URL

函数 → **函数 URL** 页签 → **创建/启用**：

- 鉴权方式：**免鉴权**（测试方便；正式可换签名鉴权）
- 发布后获得固定端点，形如：`https://{appid}-{region}.{随机}.tencentscf.com`

### 4. 访问

```
https://{你的函数URL}/proxy?url=https%3A%2F%2Fwww.baidu.com%2F
https://{你的函数URL}/advanced-proxy?url=https%3A%2F%2Fwww.baidu.com%2F
```

浏览器直接访问即可**正常显示页面**。

## 注意事项

1. **执行方法必须是 `index.main_handler`**，否则函数加载失败；
2. 函数 URL 事件格式：查询参数在 `event.queryString`（代码已兼容 `queryString` / `queryStringParameters` / `queryParameters` 三种字段名，以及字符串/Buffer 形态的 event）；
3. 二进制（图片）响应通过 `isBase64Encoded` 返回——若函数 URL 未识别该字段导致图片异常，告诉我，我按实测调整；
4. 响应体大小受平台限制（约 6MB），图片/HTML 常规资源无问题。

## 与其它平台版本对应关系

| 平台 | 入口 | 查询参数字段 | 文件 |
|------|------|-------------|------|
| 腾讯 EdgeOne Pages | `onRequest(context)` | `context.request` | `functions/*.js` |
| 阿里云 ESA Pages | `export default { fetch(request) }` | `request` | `src/esa-entry.js` |
| 华为 FunctionGraph | `exports.handler(event, context)` | `queryStringParameters` | `huawei-functiongraph/index.js` |
| 阿里云函数计算 FC | `exports.handler(event, context)` | `queryParameters` | `aliyun-fc/index.js` |
| 腾讯云函数 SCF | `exports.main_handler(event, context)` | `queryString` | `tencent-scf/index.js` |
