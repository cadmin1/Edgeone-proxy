# 阿里云函数计算 FC 代理版

将 EdgeOne Pages 代理移植到**阿里云函数计算（Function Compute, FC）**，事件函数 + HTTP 触发器，Node.js 18+ 运行时，零依赖（用 Node 内置 `fetch`）。

## 功能

- 标准代理：`/proxy?url=...`（透传，适合接口、图片、静态资源）
- 高级代理：`/advanced-proxy?url=...`（HTML/CSS 链接改写，适合连续浏览页面）
- referer / origin 改写为目标站点（绕过防盗链 403）
- 响应头黑名单过滤 + CORS 注入
- 8 秒上游超时（超时返回 504 并带原因）
- 文本响应（JSON/HTML/CSS/JS）字符串返回；二进制（图片等）以 base64 + `isBase64Encoded` 返回

## 部署步骤

### 1. 创建服务与函数

阿里云控制台 → **函数计算 FC** → **服务及函数**：

- **创建服务**：任意名称，如 `edgeone-proxy`
- **创建函数** → 选「**事件函数**」模板：
  - 运行时：**Node.js 18**
  - 处理程序：**`index.handler`**
  - 内存：256 MB，超时：60 秒
- ⚠️ **高级配置 → 请求处理程序**：选 **「处理 HTTP 请求」**（关键！否则 event 不是 HTTP 结构）

### 2. 上传代码

将 `index.js` 和 `package.json` 打成 zip 上传（函数详情 → 代码 → 上传 ZIP）：

```bash
cd aliyun-fc
zip -r proxy.zip index.js package.json
```

### 3. 创建 HTTP 触发器

函数详情 → **触发器** → **创建触发器**：

- 触发器类型：**HTTP 触发器**
- 认证方式：**无需认证**（测试方便；正式可加签名）
- 创建后会生成测试域名（形如 `https://{account-id}.{region}.fc.aliyuncs.com/2016-08-15/proxy/{service}/{function}/`）

也可以后续绑定**自定义域名**（需要已备案域名）。

### 4. 访问

```
https://{fc测试域名}/proxy?url=https%3A%2F%2Fexample.com%2F
https://{fc测试域名}/advanced-proxy?url=https%3A%2F%2Fexample.com%2F
```

## 注意事项

1. **请求处理程序必须选「处理 HTTP 请求」**，否则 `event` 拿不到 `httpMethod/path/queryParameters`，函数会返回 400。
2. **HTTP 触发器响应体大小限制**（默认约 6MB），超大文件代理会失败；图片/HTML 常规资源无问题。
3. **函数超时**建议配 60s+；代理自身 8s 上游超时已兜底返回 504。
4. **Handler 必须声明双参数** `(event, context)`——FC 运行时校验参数个数（与华为云一致）。
5. 免费额度：FC 每月有免费调用次数与资源额度，个人代理基本 0 成本。

## 与其它平台版本的对应关系

| 平台 | 入口形态 | 事件格式差异 | 文件 |
|------|---------|-------------|------|
| 腾讯 EdgeOne Pages | `onRequest(context)` | `context.request` | `functions/*.js` |
| 阿里云 ESA Pages | `export default { fetch(request) }` | `request` 对象 | `src/esa-entry.js` |
| 华为云 FunctionGraph | `exports.handler(event, context)` | `event.queryStringParameters` | `huawei-functiongraph/index.js` |
| 阿里云函数计算 FC | `exports.handler(event, context)` | `event.queryParameters` | `aliyun-fc/index.js` |

核心代理逻辑在四个平台间逐行对应，仅入口外壳与事件字段名不同。
