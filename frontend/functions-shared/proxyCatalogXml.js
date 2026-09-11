const BACKEND_ORIGIN = "https://reflexity-ram.onrender.com";
const ALLOWED_PATHS = new Set(["/feed.xml", "/sitemap.xml"]);

function baseHeaders(contentType = "text/plain; charset=utf-8") {
  return {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Strict-Transport-Security": "max-age=31536000",
  };
}

export async function proxyCatalogXml(
  context,
  path,
  { fetchImpl = fetch, logger = console } = {},
) {
  const method = context.request.method.toUpperCase();

  if (!ALLOWED_PATHS.has(path)) {
    return new Response("Not found", {
      status: 404,
      headers: { ...baseHeaders(), "Cache-Control": "no-store" },
    });
  }

  if (method !== "GET" && method !== "HEAD") {
    return new Response("Method not allowed", {
      status: 405,
      headers: {
        ...baseHeaders(),
        Allow: "GET, HEAD",
        "Cache-Control": "no-store",
      },
    });
  }

  try {
    const upstreamUrl = new URL(path, BACKEND_ORIGIN);
    const upstream = await fetchImpl(upstreamUrl, {
      method,
      headers: { Accept: "application/xml" },
      cf: { cacheEverything: true, cacheTtl: 300 },
    });

    if (!upstream.ok) {
      logger.error("Catalog XML upstream returned an error", {
        path,
        status: upstream.status,
      });
      return new Response("Catalog XML is temporarily unavailable", {
        status: 502,
        headers: {
          ...baseHeaders(),
          "Cache-Control": "no-store",
          "Retry-After": "60",
        },
      });
    }

    const headers = new Headers({
      ...baseHeaders("application/xml; charset=utf-8"),
      "Cache-Control": "public, max-age=300, s-maxage=300",
      "X-Reflexity-Source": "live-catalog-api",
    });

    for (const name of ["etag", "last-modified"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }

    return new Response(method === "HEAD" ? null : upstream.body, {
      status: 200,
      headers,
    });
  } catch (error) {
    logger.error("Catalog XML proxy failed", {
      path,
      message: error instanceof Error ? error.message : "unknown error",
    });
    return new Response("Catalog XML is temporarily unavailable", {
      status: 502,
      headers: {
        ...baseHeaders(),
        "Cache-Control": "no-store",
        "Retry-After": "60",
      },
    });
  }
}
