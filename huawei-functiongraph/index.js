'use strict';

/**
 * MiniMax proxy ported to Huawei Cloud FunctionGraph (函数工作流).
 *
 * Trigger: APIG (API Gateway) 触发器, 事件函数模式, Node.js 18+ 运行时.
 * Handler: index.handler
 *
 * Routes:
 *   GET/POST /proxy?url=...           -> standard proxy (passthrough)
 *   GET/POST /advanced-proxy?url=...  -> advanced proxy (HTML/CSS rewrite)
 *
 * Feature set: 响应头过滤(黑名单)、CORS、referer/origin 改写(防盗链)、8s 上游超时.
 * Binary responses (images etc.) are returned as base64 with isBase64Encoded=true.
 */

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

exports.handler = async (event, context) => {
  const method = event.httpMethod || 'GET';
  const clientHeaders = normalizeHeaders(event.headers || {});
  const query = event.queryStringParameters || {};
  const path = event.path || '/';
  const targetUrl = query.url;

  if (method === 'OPTIONS') {
    return buildResponse(204, null, createCorsHeaders());
  }

  if (!targetUrl) {
    return buildResponse(400, 'Missing target URL parameter', textHeaders());
  }

  const isProxyRoute =
    path === '/proxy' || path.startsWith('/proxy/') ||
    path === '/advanced-proxy' || path.startsWith('/advanced-proxy/');
  if (!isProxyRoute) {
    return buildResponse(404, 'Not Found', textHeaders());
  }

  const mode = path.startsWith('/advanced-proxy') ? 'advanced' : 'basic';

  try {
    const parsedTarget = new URL(targetUrl);
    const proxyBase = buildProxyBase(clientHeaders, parsedTarget, mode);
    const upstreamHeaders = buildUpstreamHeaders(clientHeaders, parsedTarget);
    const body = buildBody(method, event);

    const upstream = await fetchWithTimeout(parsedTarget.href, {
      method,
      headers: upstreamHeaders,
      body: body || undefined,
      redirect: 'follow'
    });

    const responseHeaders = copyResponseHeaders(upstream.headers);
    addCorsHeaders(responseHeaders);
    responseHeaders['X-Proxied-By'] = 'Huawei-FunctionGraph-Proxy';

    const contentType = upstream.headers.get('content-type') || '';

    if (mode === 'advanced' && contentType.includes('text/html')) {
      let html = await upstream.text();
      html = rewriteHtml(html, parsedTarget, proxyBase);
      responseHeaders['Content-Type'] = 'text/html; charset=UTF-8';
      return buildResponse(upstream.status, html, responseHeaders);
    }

    if (mode === 'advanced' && contentType.includes('text/css')) {
      let css = await upstream.text();
      css = rewriteCss(css, parsedTarget, proxyBase);
      responseHeaders['Content-Type'] = 'text/css; charset=UTF-8';
      return buildResponse(upstream.status, css, responseHeaders);
    }

    // 文本类响应（JSON/JS/XML/text 等）直接字符串返回；其余（图片/视频/字体等）走 base64
    if (isTextContentType(contentType)) {
      const text = await upstream.text();
      return buildResponse(upstream.status, text, responseHeaders);
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    return buildResponse(upstream.status, buf.toString('base64'), responseHeaders, true);
  } catch (error) {
    const status = error.name === 'AbortError' ? 504 : 500;
    const detail = error.name === 'AbortError' ? 'upstream request timed out' : error.message;
    return buildResponse(status, `Proxy request failed: ${detail}`, textHeaders());
  }
};

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

function buildResponse(statusCode, body, headers, isBase64Encoded = false) {
  const resp = { statusCode, headers, body };
  if (isBase64Encoded) {
    resp.isBase64Encoded = true;
  }
  return resp;
}

function normalizeHeaders(raw) {
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value !== undefined && value !== null) {
      out[key.toLowerCase()] = String(value);
    }
  }
  return out;
}

function buildBody(method, event) {
  if (method === 'GET' || method === 'HEAD' || !event.body) {
    return null;
  }
  return event.isBase64Encoded
    ? Buffer.from(event.body, 'base64')
    : Buffer.from(event.body, 'utf8');
}

function buildProxyBase(clientHeaders, targetUrl, mode) {
  const host = clientHeaders.host || clientHeaders['x-forwarded-host'] || '';
  const route = mode === 'advanced' ? 'advanced-proxy' : 'proxy';
  return host ? `${targetUrl.protocol}//${host}/${route}?url=` : `/${route}?url=`;
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

function createCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Max-Age': '86400'
  };
}

function addCorsHeaders(headers) {
  headers['Access-Control-Allow-Origin'] = '*';
  headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
  headers['Access-Control-Allow-Headers'] = '*';
  headers['Access-Control-Max-Age'] = '86400';
  return headers;
}

function textHeaders() {
  return addCorsHeaders({ 'Content-Type': 'text/plain; charset=UTF-8' });
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
