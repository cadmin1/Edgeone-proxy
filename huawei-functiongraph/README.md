# 华为云 FunctionGraph 代理版

将 EdgeOne Pages 代理移植到**华为云函数工作流（FunctionGraph）**，事件函数模式 + APIG 触发器，Node.js 18+ 运行时，零依赖（用 Node 内置 `fetch`）。

## 功能

- 标准代理：`/proxy?url=...`（透传，适合接口、图片、静态资源）
- 高级代理：`/advanced-proxy?url=...`（HTML/CSS 链接改写，适合连续浏览页面）
- referer / origin 改写为目标站点（绕过防盗链 403）
- 响应头黑名单过滤 + CORS 注入
- 8 秒上游超时（超时返回 504 并带原因，避免干等）
- 二进制响应（图片等）以 base64 + `isBase64Encoded` 返回，自动兼容

## 部署步骤

### 1. 创建函数

华为云控制台 → **函数工作流 FunctionGraph** → 函数 → **创建函数**：

- 模板：空白模板
- 运行时：**Node.js 18.x**（或更高）
- 处理程序：`index.handler`
- 内存：256 MB
- 超时：60 秒（可调）

### 2. 上传代码

将 `index.js` 和 `package.json` 打成 zip 上传（也可直接用控制台在线编辑器粘贴 `index.js` 内容）：

```bash
cd huawei-functiongraph
zip -r proxy.zip index.js package.json
```

### 3. 创建触发器

- 创建触发器 → **API 网关（APIG）**
- 请求方法：GET、POST
- 发布环境：RELEASE
- 鉴权方式：无认证（开放）或按需配置

### 4. 访问

```
https://{apig域名}/proxy?url=https%3A%2F%2Fexample.com%2F
https://{apig域名}/advanced-proxy?url=https%3A%2F%2Fexample.com%2F
```

## 注意事项

1. **APIG 响应体大小限制**：共享版默认响应体有大小上限（视版本而定，约几 MB），超大文件代理会失败；专享版可调。图片、HTML 等常规资源无问题。
2. **函数超时**：上游慢时建议把函数超时配到 60s+；代理自身 8s 超时已兜底返回 504。
3. **CORS**：响应已带 `Access-Control-Allow-Origin: *`，前端可跨域调用。
4. **防盗链头**：仅当客户端请求携带 referer/origin 时才改写为目标站点 origin，无来源请求不加语义。

## 与其它平台版本的对应关系

| 平台 | 入口形态 | 文件 |
|------|---------|------|
| 腾讯 EdgeOne Pages | `export async function onRequest(context)` | `functions/proxy.js`、`functions/advanced-proxy.js` |
| 阿里云 ESA Pages | `export default { fetch(request) }` | `src/esa-entry.js` |
| 华为云 FunctionGraph | `exports.handler(event)` | `huawei-functiongraph/index.js` |

核心代理逻辑（头过滤、CORS、HTML/CSS 改写、防盗链、超时）在三个平台间逐行对应，仅入口外壳不同。
