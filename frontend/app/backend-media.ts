type BackendConfigResponse = {
  backend_url?: string;
  detail?: string;
};

let backendBaseUrlPromise: Promise<string> | null = null;

async function loadBackendBaseUrl() {
  let response: Response;

  try {
    response = await fetch("/api/backend-config", { cache: "no-store" });
  } catch {
    throw new Error(
      "Could not load the video-upload address. Check your connection and try again.",
    );
  }

  const responseText = await response.text();
  let result: BackendConfigResponse = {};

  if (responseText) {
    try {
      result = JSON.parse(responseText) as BackendConfigResponse;
    } catch {
      throw new Error(
        "The video-upload configuration returned an invalid response.",
      );
    }
  }

  if (!response.ok) {
    throw new Error(
      result.detail ||
        "Video uploads are not configured. Add BACKEND_URL in Vercel and redeploy.",
    );
  }
  if (!result.backend_url) {
    throw new Error("The video-upload configuration is incomplete.");
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(result.backend_url);
  } catch {
    throw new Error("The configured video-upload address is invalid.");
  }
  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("The configured video-upload address is invalid.");
  }

  return parsedUrl.toString().replace(/\/+$/, "");
}

export function getBackendBaseUrl() {
  if (!backendBaseUrlPromise) {
    backendBaseUrlPromise = loadBackendBaseUrl().catch((error) => {
      backendBaseUrlPromise = null;
      throw error;
    });
  }
  return backendBaseUrlPromise;
}

export async function getBackendMediaUrl(path: string) {
  const backendBaseUrl = await getBackendBaseUrl();
  return new URL(
    path.replace(/^\/+/, ""),
    `${backendBaseUrl.replace(/\/+$/, "")}/`,
  ).toString();
}
