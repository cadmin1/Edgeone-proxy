'use strict';

/**
 * MiniMax proxy ported to Tencent Cloud SCF Web 函数 (HTTP-triggered function).
 *
 * Web 函数规范：
 *   - 启动文件 scf_bootstrap 启动本服务，监听 0.0.0.0:9000（平台转发原生 HTTP 请求，无事件转换）
 *   - 无需 main_handler；直接处理 Node http.IncomingMessage / ServerResponse
 *
 * Routes:
 *   GET/POST /proxy?url=...           -> standard proxy (passthrough)
 *   GET/POST /advanced-proxy?url=...  -> advanced proxy (HTML/CSS rewrite)
 *
 * Feature set: 响应头过滤(黑名单)、CORS、referer/origin 改写(防盗链)、8s 上游超时.
 * 二进制(图片)直接写回 Buffer；文本(JSON/HTML/CSS)改写后字符串写回。
 * Web 函数直接转发 HTTP 响应，无 Content-Disposition 强制下载问题。
 */

const http = require('http');

const FORWARDED_REQUEST_HEADERS = [
  'user-agent',
  'accept',
  'accept-language',
  'content-type',
  'cache-control'
];

const BLOCKED_RESPONSE_HEADERS = new Set([
  'alt-svc',
  'clear-site-data',
  'connection',
  'content-encoding',
  'content-length',
  'content-security-policy',
  'content-security-policy-report-only',
  'cross-origin-embedder-policy',
  'cross-origin-opener-policy',
  'cross-origin-resource-policy',
  'feature-policy',
  'frame-options',
  'nel',
  'permissions-policy',
  'report-to',
  'reporting-endpoints',
  'set-cookie',
  'set-cookie2',
  'strict-transport-security',
  'transfer-encoding',
  'x-content-type-options',
  'x-frame-options'
]);

const UPSTREAM_TIMEOUT_MS = 8000;
const PORT = Number(process.env.PORT) || 9000;

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    return writeText(res, 400, 'Bad request');
  }

  const method = req.method || 'GET';
  const path = url.pathname;
  const targetUrl = url.searchParams.get('url');

  if (method === 'OPTIONS') {
    res.writeHead(204, createCorsHeaders());
    return res.end();
  }

  if (!targetUrl) {
    return writeText(res, 400, 'Missing target URL parameter');
  }

  const isProxyRoute =
    path === '/proxy' || path.startsWith('/proxy/') ||
    path === '/advanced-proxy' || path.startsWith('/advanced-proxy/');
  if (!isProxyRoute) {
    return writeText(res, 404, 'Not Found');
  }

  const mode = path.startsWith('/advanced-proxy') ? 'advanced' : 'basic';

  try {
    const parsedTarget = new URL(targetUrl);
    const host = req.headers.host || 'localhost';
    const proxyBase = `${parsedTarget.protocol}//${host}/${mode === 'advanced' ? 'advanced-proxy' : 'proxy'}?url=`;
    const body = await readBody(req);
    const upstreamHeaders = buildUpstreamHeaders(req.headers, parsedTarget);

    const upstream = await fetchWithTimeout(parsedTarget.href, {
      method,
      headers: upstreamHeaders,
      body: method === 'GET' || method === 'HEAD' ? undefined : body,
      redirect: 'follow'
    });

    const responseHeaders = copyResponseHeaders(upstream.headers);
    addCorsHeaders(responseHeaders);
    responseHeaders['X-Proxied-By'] = 'Tencent-SCF-Web-Proxy';

    const contentType = upstream.headers.get('content-type') || '';

    if (mode === 'advanced' && contentType.includes('text/html')) {
      let html = await upstream.text();
      html = rewriteHtml(html, parsedTarget, proxyBase);
      responseHeaders['Content-Type'] = 'text/html; charset=UTF-8';
      res.writeHead(upstream.status, responseHeaders);
      return res.end(html);
    }

    if (mode === 'advanced' && contentType.includes('text/css')) {
      let css = await upstream.text();
      css = rewriteCss(css, parsedTarget, proxyBase);
      responseHeaders['Content-Type'] = 'text/css; charset=UTF-8';
      res.writeHead(upstream.status, responseHeaders);
      return res.end(css);
    }

    if (isTextContentType(contentType)) {
      const text = await upstream.text();
      res.writeHead(upstream.status, responseHeaders);
      return res.end(text);
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, responseHeaders);
    return res.end(buf);
  } catch (error) {
    const status = error.name === 'AbortError' ? 504 : 500;
    const detail = error.name === 'AbortError' ? 'upstream request timed out' : error.message;
    console.error(`Proxy request failed: ${error.message}`);
    return writeText(res, status, `Proxy request failed: ${detail}`);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`proxy listening on 0.0.0.0:${PORT}`);
});

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function buildUpstreamHeaders(clientHeaders, targetUrl) {
  const headers = {};

  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = clientHeaders[name];
    if (value) {
      headers[name] = value;
    }
  }

  // 防盗链：referer/origin 改写为目标站点自身（仅当客户端携带时）
  const targetOrigin = targetUrl.origin;
  if (clientHeaders.referer) {
    headers.referer = targetOrigin;
  }
  if (clientHeaders.origin) {
    headers.origin = targetOrigin;
  }

  return headers;
}

async function fetchWithTimeout(input, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function copyResponseHeaders(sourceHeaders) {
  const headers = {};
  for (const [key, value] of sourceHeaders.entries()) {
    if (!BLOCKED_RESPONSE_HEADERS.has(key.toLowerCase())) {
      headers[key] = value;
    }
  }
  return headers;
}

function addCorsHeaders(headers) {
  headers['Access-Control-Allow-Origin'] = '*';
  headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
  headers['Access-Control-Allow-Headers'] = '*';
  headers['Access-Control-Max-Age'] = '86400';
  return headers;
}

function createCorsHeaders() {
  return addCorsHeaders({});
}

function writeText(res, status, message) {
  res.writeHead(status, addCorsHeaders({ 'Content-Type': 'text/plain; charset=UTF-8' }));
  res.end(message);
}

function isTextContentType(ct) {
  const c = (ct || '').toLowerCase();
  if (!c) {
    return true;
  }
  return (
    c.startsWith('text/') ||
    c.includes('json') ||
    c.includes('javascript') ||
    c.includes('xml') ||
    c.includes('x-www-form-urlencoded') ||
    c.includes('graphql') ||
    c.includes('svg')
  );
}

function rewriteHtml(html, targetUrl, proxyBase) {
  return rewriteCss(
    rewriteHtmlAttributes(stripRestrictiveMarkup(html), targetUrl, proxyBase),
    targetUrl,
    proxyBase
  );
}

function stripRestrictiveMarkup(html) {
  return html
    .replace(/<meta\b[^>]*http-equiv=(["']?)content-security-policy\1[^>]*>/gi, '')
    .replace(/\s+integrity=("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
}

function rewriteHtmlAttributes(html, targetUrl, proxyBase) {
  const urlAttributes = [
    'action',
    'data-canonical-src',
    'data-href',
    'data-src',
    'data-url',
    'formaction',
    'href',
    'manifest',
    'poster',
    'src'
  ].join('|');

  const attrPattern = new RegExp(`\\b(${urlAttributes})=(["'])([^"']+)\\2`, 'gi');
  html = html.replace(attrPattern, (match, attr, quote, value) => {
    const proxiedUrl = toProxyUrl(value, targetUrl, proxyBase);
    return proxiedUrl ? `${attr}=${quote}${proxiedUrl}${quote}` : match;
  });

  html = html.replace(/\bsrcset=(["'])([^"']+)\1/gi, (match, quote, value) => {
    const rewritten = rewriteSrcset(value, targetUrl, proxyBase);
    return rewritten === value ? match : `srcset=${quote}${rewritten}${quote}`;
  });

  return html;
}

function rewriteSrcset(value, targetUrl, proxyBase) {
  return value
    .split(',')
    .map((candidate) => {
      const trimmed = candidate.trim();
      if (!trimmed || trimmed.startsWith('data:')) {
        return candidate;
      }

      const parts = trimmed.split(/\s+/);
      const proxiedUrl = toProxyUrl(parts[0], targetUrl, proxyBase);
      if (!proxiedUrl) {
        return candidate;
      }

      parts[0] = proxiedUrl;
      return parts.join(' ');
    })
    .join(', ');
}

function rewriteCss(css, targetUrl, proxyBase) {
  let rewritten = css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (match, quote, value) => {
    const proxiedUrl = toProxyUrl(value.trim(), targetUrl, proxyBase);
    if (!proxiedUrl) {
      return match;
    }
    return `url(${quote}${proxiedUrl}${quote})`;
  });

  rewritten = rewritten.replace(/@import\s+(["'])([^"']+)\1/gi, (match, quote, value) => {
    const proxiedUrl = toProxyUrl(value, targetUrl, proxyBase);
    return proxiedUrl ? `@import ${quote}${proxiedUrl}${quote}` : match;
  });

  return rewritten;
}

function toProxyUrl(value, targetUrl, proxyBase) {
  const trimmed = value.trim();

  if (
    !trimmed ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('blob:') ||
    trimmed.startsWith('javascript:') ||
    trimmed.startsWith('mailto:') ||
    trimmed.startsWith('tel:') ||
    trimmed.startsWith('about:') ||
    trimmed.includes('/advanced-proxy?url=')
  ) {
    return null;
  }

  try {
    return `${proxyBase}${encodeURIComponent(new URL(trimmed, targetUrl.href).href)}`;
  } catch {
    return null;
  }
}
