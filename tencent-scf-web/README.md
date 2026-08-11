# 腾讯云函数 SCF Web 函数版（HTTP 触发函数）

将代理部署为腾讯云 **Web 函数（HTTP 触发函数）**，代码内建 HTTP Server 监听 **0.0.0.0:9000**，SCF 把函数 URL 收到的原生 HTTP 请求直接转发给该端口。零依赖。

> 使用前提：SCF 的**函数 URL** 需要 **Web 函数**类型（事件函数不支持/受限）。API 网关已停服（2025-06-30），无需再依赖它。

## 相比事件函数版 / 阿里 FC 的优势

- **原生 HTTP 请求**直接进函数，无事件转换、无 `Content-Disposition: attachment` 强制下载，**浏览器直接渲染页面**；
- 二进制（图片）原生 Buffer 写回，无 base64 兼容问题；
- 免费额度：每月 40 万 GB-秒 + 400 万次调用，个人 0 成本。

## 部署步骤

### 1. 创建函数

腾讯云控制台 → **云函数 SCF** → 新建：

- 函数类型：**Web 函数（HTTP 触发函数）**
- 运行环境：**Nodejs 18.15**（若控制台无 18，选 16.13 并把 `scf_bootstrap` 里的 `node18` 改成 `node16`）
- 内存：256 MB，执行超时：60 秒

### 2. 准备代码包

本目录下文件：

```
tencent-scf-web/
├── index.js          # HTTP Server（监听 0.0.0.0:9000），代理逻辑
├── scf_bootstrap     # 启动文件（必须这个名字，755 权限、LF 结尾）
└── package.json
```

**scf_bootstrap 内容**（Nodejs 18.15 运行时）：

```bash
#!/bin/bash
export PORT=9000
/var/lang/node18/bin/node index.js
```

> 若选择 Nodejs 16.13 运行时，把最后一行改为 `/var/lang/node16/bin/node index.js`。

上传 zip 时**已包含可执行权限**（755）。如果上传后报 405 / 启动失败：

1. 检查 zip 里 `scf_bootstrap` 是否在根目录、无 BOM、LF 结尾；
2. 或改用控制台方式：**高级配置 → 启动命令**，粘贴上面的内容（代码包里不要带 scf_bootstrap）。

### 3. 启用函数 URL

函数 → **函数 URL** 页签 → 创建/启用 → 鉴权方式：**免鉴权** → 获得端点 `https://{appid}-{region}.{随机}.tencentscf.com`。

### 4. 访问

```
https://{你的函数URL}/proxy?url=https%3A%2F%2Fwww.baidu.com%2F
https://{你的函数URL}/advanced-proxy?url=https%3A%2F%2Fwww.baidu.com%2F
```

浏览器直接显示页面 ✅

## 本地测试

```bash
PORT=9000 node index.js
curl "http://127.0.0.1:9000/proxy?url=https%3A%2F%2Fwww.baidu.com%2F"
```

## 注意事项

1. **必须监听 `0.0.0.0:9000`**（不能用 127.0.0.1），端口取 `PORT` 环境变量（默认 9000）；
2. **scf_bootstrap**：文件名不能改、需 755/777 权限、**LF 结尾**、首行 `#!/bin/bash`；命令用绝对路径 `/var/lang/node18/bin/node`；
3. Web 函数响应限制：单个 header key/value ≤ 4KB，响应体 ≤ 6MB（图片/HTML 常规资源没问题）；
4. 8 秒上游超时兜底（超时返回 504 带原因）。

## 与其它平台版本对应关系

| 平台 | 形态 | 入口 | 文件 |
|------|------|------|------|
| 腾讯 EdgeOne Pages | 边缘函数 | `onRequest(context)` | `functions/*.js` |
| 阿里云 ESA Pages | 边缘函数 | `export default { fetch(request) }` | `src/esa-entry.js` |
| 华为 FunctionGraph | 事件函数 | `exports.handler(event, context)` | `huawei-functiongraph/index.js` |
| 阿里云函数计算 FC | 事件函数 | `exports.handler(event, context)` | `aliyun-fc/index.js` |
| 腾讯 SCF（事件函数） | 事件函数 | `exports.main_handler(event, context)` | `tencent-scf/index.js` |
| **腾讯 SCF（Web 函数）** | HTTP Server :9000 | `scf_bootstrap` 启动 | **`tencent-scf-web/`** |
