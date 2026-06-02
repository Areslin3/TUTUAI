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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isNetworkFailure = (error) => {
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
  if (isNetworkFailure(error)) {
    return new Error("无法连接云端存储，请检查网络后刷新页面重试");
  }
  if (error instanceof Error) return error;
  return new Error(String(error));
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

const withCloudRetry = async (operation) => {
  let lastError = null;
  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt += 1) {
    if (RETRY_DELAYS_MS[attempt]) await sleep(RETRY_DELAYS_MS[attempt]);
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isNetworkFailure(error) || attempt === RETRY_DELAYS_MS.length - 1) break;
    }
  }
  throw normalizeCloudError(lastError);
};

export const isCloudSyncEnabled = () => Boolean(CLOUD_API_URL);

export const ensureCloudClient = async () => ({ ready: true, transport: "netlify" });

export const resetCloudTransport = async () => ensureCloudClient();

export const getCloudTransportLabel = () => "Netlify 云端";

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

export const fetchCloudUpdatedAt = async () =>
  withCloudRetry(async () => {
    const payload = await cloudRequest("", { method: "GET" });
    return payload?.updated_at ?? null;
  });

export const saveCloudState = async (state) =>
  withCloudRetry(async () => {
    const payload = await cloudRequest("", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state }),
    });
    return payload?.updated_at || new Date().toISOString();
  });

/** Netlify 云端无 Realtime，由 App 内轮询兜底。 */
export const subscribeAppStateRemoteChanges = (_onChange, onStatus) => {
  onStatus?.("POLLING_ONLY");
  return () => {};
};
