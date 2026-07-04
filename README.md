# EdgeOne Proxy

一个基于 EdgeOne Pages Functions 的轻量代理页面，包含静态前端和两个 Functions 代理入口。

请仅在合规、授权和研究场景中使用本项目。不要将它用于绕过访问控制、未授权抓取、攻击测试或其他违反目标站点条款与当地法律法规的用途。

## 功能

- 静态前端页面，支持浅色 / 深色模式。
- 支持简体中文 / English 切换。
- 提供标准代理与高级代理两个入口。
- 适配 EdgeOne Pages 直接上传部署。

## 路由

- 标准代理：`/proxy?url=...`
- 高级代理：`/advanced-proxy?url=...`

## 使用方法

要使用此代理访问目标地址，请按照以下步骤操作：

1. 通过页面生成链接

   打开部署后的站点首页，在输入框中填写完整目标 URL，例如 `https://example.com/`，然后选择标准代理或高级代理模式并点击开始访问。

2. 直接发出请求

   也可以直接向部署后的 EdgeOne Pages 域名发出请求，将 `url` 参数替换为需要访问的目标地址。

   标准代理示例：

   `https://your-edgeone-domain.com/proxy?url=https%3A%2F%2Fexample.com%2F`

   高级代理示例：

   `https://your-edgeone-domain.com/advanced-proxy?url=https%3A%2F%2Fexample.com%2F`

3. 选择代理模式

   标准代理适合接口、图片、静态资源或单个页面访问。高级代理会尝试改写页面中的链接、样式资源和部分相对路径，更适合连续浏览页面。

4. 跨域请求

   Functions 会返回基础 CORS 响应头，便于在前端 JavaScript 中请求代理资源。请确保目标站点允许被访问，并确认您的使用场景具备合法授权。

## 部署

如果使用 EdgeOne Pages 直接上传部署，可压缩以下文件和目录：

- `index.html`
- `styles.css`
- `favicon.ico`
- `favicon.svg`
- `functions/`

确保 `functions/` 目录位于项目根目录，EdgeOne Pages 会自动识别其中的函数路由。

## 本地开发

```bash
npm install
npm run dev
```

## 目录

```text
.
├── index.html
├── styles.css
├── favicon.ico
├── favicon.svg
├── functions/
│   ├── proxy.js
│   └── advanced-proxy.js
├── package.json
└── README.md
```

## 免责声明

- **责任限制：** 作者不对脚本可能导致的任何安全问题、数据损失、服务中断、法律纠纷或其他损害负责。使用此脚本需自行承担风险。

- **不当使用：** 使用者需了解，本脚本可能被用于非法活动或未经授权的访问。作者强烈反对和谴责任何不当使用脚本的行为，并鼓励合法合规的使用。

- **合法性：** 请确保遵守所有适用的法律、法规和政策，包括但不限于互联网使用政策、隐私法规和知识产权法。确保您拥有对目标地址的合法权限。

- **自担风险：** 使用此脚本需自行承担风险。作者和 EdgeOne 不对脚本的滥用、不当使用或导致的任何损害承担责任。

此免责声明针对非中国大陆地区用户，如在中国大陆地区使用，需遵守相关地区法律法规，且由使用者自行承担相应风险与责任。
