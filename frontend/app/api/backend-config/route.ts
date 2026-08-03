const LOCAL_BACKEND_URL = "http://127.0.0.1:8000";

function normalizeBackendUrl(rawValue: string) {
  const parsedUrl = new URL(rawValue);

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("Unsupported backend URL protocol.");
  }
  if (parsedUrl.username || parsedUrl.password) {
    throw new Error("Backend URL credentials are not allowed.");
  }

  parsedUrl.search = "";
  parsedUrl.hash = "";
  parsedUrl.pathname = parsedUrl.pathname.replace(/\/+$/, "");
  return parsedUrl.toString().replace(/\/+$/, "");
}

export function GET() {
  const configuredBackendUrl =
    process.env.BACKEND_URL?.trim() ||
    (process.env.NODE_ENV === "development" ? LOCAL_BACKEND_URL : "");

  if (!configuredBackendUrl) {
    return Response.json(
      {
        detail:
          "Video uploads are unavailable because BACKEND_URL is not configured for this deployment.",
      },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  try {
    return Response.json(
      { backend_url: normalizeBackendUrl(configuredBackendUrl) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      {
        detail:
          "Video uploads are unavailable because BACKEND_URL is not a valid HTTP address.",
      },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
