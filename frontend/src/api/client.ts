// Same-origin API client. NEXT_PUBLIC_API_BASE is empty in the container build and
// points at the backend (e.g. http://localhost:8000) for the `next dev` loop (D-13).
// It must stay a direct property access so Next inlines it at build time.
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

/** A non-2xx response; `message` is the server's `error` string when present. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object" && "error" in body) {
      const error = (body as { error: unknown }).error;
      if (typeof error === "string" && error) return error;
    }
  } catch {
    // Non-JSON body: fall through to the generic message.
  }
  if (res.status === 422) return "Invalid request";
  return `Request failed (${res.status})`;
}

/** Fetch JSON from `/api/*`. Throws ApiError on non-2xx; resolves undefined for 204. */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    throw new ApiError(res.status, await errorMessage(res));
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}
