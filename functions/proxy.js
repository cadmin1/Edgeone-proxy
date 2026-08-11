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

export async function onRequest({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: createCorsHeaders()
    });
  }

  try {
    const url = new URL(request.url);
    const targetUrl = url.searchParams.get("url");

    if (!targetUrl) {
      return textResponse("Missing target URL parameter", 400);
    }

    const targetRequest = await createTargetRequest(request, targetUrl);
    const response = await fetch(targetRequest);
    const responseHeaders = copyResponseHeaders(response.headers);
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    responseHeaders.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    responseHeaders.set("Access-Control-Allow-Headers", "*");
    responseHeaders.set("X-Proxied-By", "EdgeOne-Pages-Proxy");
    // 下载模式：成功响应带 Content-Disposition: attachment（可选 ?filename= 指定下载名）
    setDownloadHeader(responseHeaders, url);

    const body = await response.arrayBuffer();

    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders
    });
  } catch (error) {
    console.error(`Proxy request failed: ${error.message}`);
    return textResponse(`Proxy request failed: ${error.message}`, 500);
  }
}

async function createTargetRequest(request, targetUrl) {
  const headers = new Headers();

  for (const header of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(header);
    if (value) {
      headers.set(header, value);
    }
  }

  return new Request(targetUrl, {
    method: request.method,
    headers,
    body: request.method !== "GET" && request.method !== "HEAD" ? await request.blob() : undefined,
    redirect: "follow"
  });
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
  // 默认下载：成功响应带 Content-Disposition: attachment；
  // ?inline=1 切回内联显示（不带下载头）；?filename=xxx 指定下载文件名
  if (requestUrl.searchParams.get("inline") === "1") {
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
