type BackendHealth = {
  status: "ok";
  database?: string;
};

type ErrorPayload = {
  detail?: string;
};

export async function checkBackendHealth(): Promise<BackendHealth> {
  let response: Response;

  try {
    response = await fetch("/api/health", { cache: "no-store" });
  } catch {
    throw new Error("The backend health check could not be reached.");
  }

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? ((await response.json()) as BackendHealth & ErrorPayload)
    : null;

  if (!response.ok) {
    throw new Error(
      payload?.detail ||
        `The backend health check returned HTTP ${response.status}.`,
    );
  }

  if (payload?.status !== "ok") {
    throw new Error("The backend returned an invalid health response.");
  }

  return payload;
}
