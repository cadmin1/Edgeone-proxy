const FORWARDED_REQUEST_HEADERS = [
  "user-agent",
  "accept",
  "accept-language",
  "content-type",
  "cache-control"
];

const BLOCKED_RESPONSE_HEADERS = new Set([
  "alt-svc",
  "clear-site-data",
  "connection",
  "content-encoding",
  "content-length",
  "content-security-policy",
  "content-security-policy-report-only",
  "cross-origin-embedder-policy",
  "cross-origin-opener-policy",
  "cross-origin-resource-policy",
  "feature-policy",
  "frame-options",
  "nel",
  "permissions-policy",
  "report-to",
  "reporting-endpoints",
  "set-cookie",
  "set-cookie2",
  "strict-transport-security",
  "transfer-encoding",
  "x-content-type-options",
  "x-frame-options"
]);

const UPSTREAM_TIMEOUT_MS = 8000;

export async function onRequest({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: createCorsHeaders()
    });
  }

  try {
    const requestUrl = new URL(request.url);
    const targetUrl = requestUrl.searchParams.get("url");

    if (!targetUrl) {
      return textResponse("Missing target URL parameter", 400);
    }

    const parsedTargetUrl = new URL(targetUrl);
    const proxyBase = `${requestUrl.protocol}//${requestUrl.host}/advanced-proxy?url=`;
    const response = await fetchTarget(request, parsedTargetUrl);
    const responseHeaders = copyResponseHeaders(response.headers);
    const contentType = response.headers.get("content-type") || "";

    responseHeaders.set("Access-Control-Allow-Origin", "*");
    responseHeaders.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    responseHeaders.set("Access-Control-Allow-Headers", "*");
    responseHeaders.set("X-Proxied-By", "EdgeOne-Pages-Advanced-Proxy");
    // 下载模式：成功响应带 Content-Disposition: attachment（可选 ?filename= 指定下载名）
    setDownloadHeader(responseHeaders, requestUrl);

    if (contentType.includes("text/html")) {
      let html = await response.text();
      html = rewriteHtml(html, parsedTargetUrl, proxyBase);
      responseHeaders.set("Content-Type", "text/html; charset=UTF-8");

      return new Response(html, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders
      });
    }

    if (contentType.includes("text/css")) {
      let css = await response.text();
      css = rewriteCss(css, parsedTargetUrl, proxyBase);
      responseHeaders.set("Content-Type", "text/css; charset=UTF-8");

      return new Response(css, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders
      });
    }

    const body = await response.arrayBuffer();
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders
    });
  } catch (error) {
    console.error(`Advanced proxy request failed: ${error.message}`);
    const status = error.name === "AbortError" ? 504 : 500;
    const detail = error.name === "AbortError" ? "upstream request timed out" : error.message;
    return textResponse(`Proxy request failed: ${detail}`, status);
  }
}

async function fetchTarget(request, targetUrl) {
  const headers = new Headers();

  for (const header of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(header);
    if (value) {
      headers.set(header, value);
    }
  }

  const targetOrigin = targetUrl.origin;
  const incomingOrigin = request.headers.get("origin");
  if (incomingOrigin) {
    headers.set("origin", targetOrigin);
  }
  // 防盗链：referer 也改写为目标 origin（仅当客户端携带时）
  if (request.headers.get("referer")) {
    headers.set("referer", targetOrigin);
  }

  return fetchWithTimeout(
    new Request(targetUrl.href, {
      method: request.method,
      headers,
      body: request.method !== "GET" && request.method !== "HEAD" ? await request.blob() : undefined,
      redirect: "follow"
    })
  );
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
  const headers = new Headers();

  for (const [key, value] of sourceHeaders.entries()) {
    if (!BLOCKED_RESPONSE_HEADERS.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  }

  return headers;
}

function createCorsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Max-Age": "86400"
  };
}

function setDownloadHeader(headers, requestUrl) {
  // 统一下载头：默认 attachment（下载）；?inline=1 → inline（内联显示）；?filename=xxx 指定下载名
  if (requestUrl.searchParams.get("inline") === "1") {
    headers.set("Content-Disposition", "inline");
    return headers;
  }
  const filename = requestUrl.searchParams.get("filename");
  if (filename) {
    const safe = filename.replace(/["\\]/g, "");
    headers.set("Content-Disposition", `attachment; filename="${safe}"`);
  } else {
    headers.set("Content-Disposition", "attachment");
  }
  return headers;
}

function textResponse(message, status) {
  const headers = new Headers(createCorsHeaders());
  headers.set("Content-Type", "text/plain; charset=UTF-8");
  return new Response(message, { status, headers });
}

function rewriteHtml(html, targetUrl, proxyBase) {
  return rewriteCss(rewriteHtmlAttributes(stripRestrictiveMarkup(html), targetUrl, proxyBase), targetUrl, proxyBase);
}

function stripRestrictiveMarkup(html) {
  return html
    .replace(/<meta\b[^>]*http-equiv=(["']?)content-security-policy\1[^>]*>/gi, "")
    .replace(/\s+integrity=("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

function rewriteHtmlAttributes(html, targetUrl, proxyBase) {
  const urlAttributes = [
    "action",
    "data-canonical-src",
    "data-href",
    "data-src",
    "data-url",
    "formaction",
    "href",
    "manifest",
    "poster",
    "src"
  ].join("|");

  const attrPattern = new RegExp(`\\b(${urlAttributes})=(["'])([^"']+)\\2`, "gi");
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
    .split(",")
    .map((candidate) => {
      const trimmed = candidate.trim();
      if (!trimmed || trimmed.startsWith("data:")) {
        return candidate;
      }

      const parts = trimmed.split(/\s+/);
      const proxiedUrl = toProxyUrl(parts[0], targetUrl, proxyBase);
      if (!proxiedUrl) {
        return candidate;
      }

      parts[0] = proxiedUrl;
      return parts.join(" ");
    })
    .join(", ");
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
    trimmed.startsWith("#") ||
    trimmed.startsWith("data:") ||
    trimmed.startsWith("blob:") ||
    trimmed.startsWith("javascript:") ||
    trimmed.startsWith("mailto:") ||
    trimmed.startsWith("tel:") ||
    trimmed.startsWith("about:") ||
    trimmed.includes("/advanced-proxy?url=")
  ) {
    return null;
  }

  try {
    return `${proxyBase}${encodeURIComponent(new URL(trimmed, targetUrl.href).href)}`;
  } catch {
    return null;
  }
}
