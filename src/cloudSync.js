const CLOUD_API_URL = (() => {
  const fromEnv = (import.meta.env.VITE_CLOUD_API_URL || "").trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (typeof window !== "undefined") {
    const { origin, hostname } = window.location;
    if (hostname.endsWith(".netlify.app") || hostname === "localhost" || hostname === "127.0.0.1") {
      return `${origin}/.netlify/functions/app-state`;
    }
  }
  return "https://beautiful-basbousa-c7556d.netlify.app/.netlify/functions/app-state";
})();

const REQUEST_TIMEOUT_MS = 25000;
const RETRY_DELAYS_MS = [0, 1000, 2500];
export const MAX_CLOUD_STATE_BYTES = 5.5 * 1024 * 1024;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class CloudConflictError extends Error {
  constructor(message, { updatedAt = null, state = null } = {}) {
    super(message || "云端数据已被其他人更新");
    this.name = "CloudConflictError";
    this.updatedAt = updatedAt;
    this.state = state;
  }
}

export class CloudPayloadTooLargeError extends Error {
  constructor(actualBytes) {
    super(`云端数据过大（约 ${Math.round(actualBytes / 1024 / 1024)}MB），请删除部分附件后再同步`);
    this.name = "CloudPayloadTooLargeError";
    this.actualBytes = actualBytes;
  }
}

const isNetworkFailure = (error) => {
  if (error instanceof CloudConflictError || error instanceof CloudPayloadTooLargeError) return false;
  const message = String(error?.message || error || "");
  return (
    error?.name === "AbortError" ||
    message.includes("Failed to fetch") ||
    message.includes("NetworkError") ||
    message.includes("Network request failed") ||
    message.includes("Load failed") ||
    message.includes("fetch failed")
  );
};

export const normalizeCloudError = (error) => {
  if (!error) return new Error("云端同步失败，请稍后重试");
  if (error instanceof CloudConflictError || error instanceof CloudPayloadTooLargeError) return error;
  if (isNetworkFailure(error)) {
    return new Error("无法连接云端存储，请检查网络后刷新页面重试");
  }
  if (error instanceof Error) return error;
  return new Error(String(error));
};

export const estimateStateBytes = (state) => {
  try {
    return new Blob([JSON.stringify(state)]).size;
  } catch {
    return JSON.stringify(state).length;
  }
};

const fetchWithTimeout = async (url, options = {}) => {
  const controller = new AbortController();
  const upstreamSignal = options.signal;
  const onAbort = () => controller.abort(upstreamSignal?.reason);
  upstreamSignal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("timeout")), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    upstreamSignal?.removeEventListener("abort", onAbort);
  }
};

const parseCloudResponse = async (response) => {
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text };
    }
  }

  if (response.status === 409) {
    throw new CloudConflictError(payload?.message, {
      updatedAt: payload?.updated_at ?? response.headers.get("x-updated-at"),
      state: payload?.state ?? null,
    });
  }

  if (response.status === 413) {
    throw new CloudPayloadTooLargeError(payload?.actual_bytes || estimateStateBytes(payload?.state));
  }

  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || `云端请求失败 (${response.status})`);
  }

  return payload || {};
};

const cloudRequest = async (path = "", options = {}) => {
  const url = `${CLOUD_API_URL}${path}`;
  const response = await fetchWithTimeout(url, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.headers || {}),
    },
  });
  return parseCloudResponse(response);
};

const withCloudRetry = async (operation, { retryOnConflict = false } = {}) => {
  let lastError = null;
  const delays = retryOnConflict ? [...RETRY_DELAYS_MS, 400, 800] : RETRY_DELAYS_MS;
  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (delays[attempt]) await sleep(delays[attempt]);
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (error instanceof CloudConflictError && retryOnConflict) continue;
      if (!isNetworkFailure(error) || attempt === delays.length - 1) break;
    }
  }
  throw normalizeCloudError(lastError);
};

export const isCloudSyncEnabled = () => Boolean(CLOUD_API_URL);

export const ensureCloudClient = async () => ({ ready: true, transport: "netlify" });

export const resetCloudTransport = async () => ensureCloudClient();

export const getCloudTransportLabel = () => "Netlify 云端";

export const fetchCloudMeta = async () =>
  withCloudRetry(async () => {
    const payload = await cloudRequest("?meta=1", { method: "GET" });
    return {
      updatedAt: payload?.updated_at ?? null,
      hasState: Boolean(payload?.has_state),
    };
  });

export const fetchCloudStateWithMeta = async () =>
  withCloudRetry(async () => {
    const payload = await cloudRequest("", { method: "GET" });
    return {
      state: payload?.state ?? null,
      updatedAt: payload?.updated_at ?? null,
    };
  });

export const fetchCloudState = async () => {
  const { state } = await fetchCloudStateWithMeta();
  return state;
};

export const fetchCloudUpdatedAt = async () => {
  const { updatedAt } = await fetchCloudMeta();
  return updatedAt;
};

export const saveCloudState = async (state, { expectedUpdatedAt = null } = {}) => {
  const bytes = estimateStateBytes(state);
  if (bytes > MAX_CLOUD_STATE_BYTES) {
    throw new CloudPayloadTooLargeError(bytes);
  }

  return withCloudRetry(
    async () => {
      const payload = await cloudRequest("", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(expectedUpdatedAt ? { "If-Updated-At": expectedUpdatedAt } : {}),
        },
        body: JSON.stringify({
          state,
          ...(expectedUpdatedAt ? { expected_updated_at: expectedUpdatedAt } : {}),
        }),
      });
      return payload?.updated_at || new Date().toISOString();
    },
    { retryOnConflict: false },
  );
};

/** Netlify 云端无 Realtime，由 App 内轮询兜底。 */
export const subscribeAppStateRemoteChanges = (_onChange, onStatus) => {
  onStatus?.("POLLING_ONLY");
  return () => {};
};

export const probeCloudConnection = async () => {
  await fetchCloudMeta();
  return true;
};
