const LOCAL_BACKEND_URL = "http://127.0.0.1:8000";

type RouteParameters = {params: Promise<{ path: string[] }>;
};

const REQUEST_HEADERS_TO_REMOVE = [
  "connection",
  "content-length",
  "host",
  "transfer-encoding",
];

async function forwardRequest(request: Request, context: RouteParameters) {
  const backendUrl =
    process.env.BACKEND_URL?.trim() ||
    (process.env.NODE_ENV === "development" ? LOCAL_BACKEND_URL : "");

  if (!backendUrl) {
    return Response.json(
      {
        detail:
          "BACKEND_URL is not configured for this deployment.",
      },
      { status: 503 },
    );
  }

  const { path } = await context.params;
  const incomingUrl = new URL(request.url);
  let targetUrl: URL;

  try {
    targetUrl = new URL(
      path.map(encodeURIComponent).join("/"),
      `${backendUrl.replace(/\/+$/, "")}/`,
    );
  } catch {
    return Response.json(
      { detail: "BACKEND_URL is not a valid HTTP address." },
      { status: 503 },
    );
  }

  targetUrl.search = incomingUrl.search;

  const headers = new Headers(request.headers);
  REQUEST_HEADERS_TO_REMOVE.forEach((header) => headers.delete(header));

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const options: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    body: hasBody ? request.body : undefined,
    cache: "no-store",
  };
  if (hasBody) options.duplex = "half";

  try {
    const backendResponse = await fetch(targetUrl, options);
    const responseHeaders = new Headers(backendResponse.headers);
    responseHeaders.delete("content-encoding");
    responseHeaders.delete("content-length");
    responseHeaders.delete("transfer-encoding");

    return new Response(backendResponse.body, {
      status: backendResponse.status,
      statusText: backendResponse.statusText,
      headers: responseHeaders,
    });
  } catch {
    return Response.json(
      {
        detail:
          "The backend is not reachable. Verify BACKEND_URL and the FastAPI service.",
      },
      { status: 503 },
    );
  }
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = forwardRequest;
export const POST = forwardRequest;
export const PUT = forwardRequest;
export const PATCH = forwardRequest;
export const DELETE = forwardRequest;
export const HEAD = forwardRequest;
