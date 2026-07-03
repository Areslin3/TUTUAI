import { getStore } from "@netlify/blobs";
import { mergeCollaborativeState } from "../../shared/collabMerge.js";

const STATE_KEY = "main";
const PATH_PREFIXES = ["/.netlify/functions/app-state", "/api/app-state"];
const MAX_STATE_BYTES = 5.5 * 1024 * 1024;

const corsHeaders = () => ({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, x-app-token, if-updated-at",
  "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS, HEAD",
  "Access-Control-Expose-Headers": "x-updated-at",
});

const stripPrefix = (pathname) => {
  for (const prefix of PATH_PREFIXES) {
    if (pathname.startsWith(prefix)) {
      return pathname.slice(prefix.length) || "/";
    }
  }
  return pathname;
};

const getStateStore = () =>
  getStore({
    name: "tutu-app-state",
    consistency: "strong",
  });

const jsonResponse = (payload, status, extraHeaders = {}) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders(),
      "Content-Type": "application/json",
      ...extraHeaders,
    },
  });

const readCurrentEntry = async (store) => store.getWithMetadata(STATE_KEY, { type: "json" });

const getRequiredToken = () => (process.env.APP_STATE_TOKEN || "").trim();

const hasCoreStateShape = (state) =>
  Boolean(state) && Array.isArray(state.users) && Array.isArray(state.tasks);

const isAuthorized = (request) => {
  const required = getRequiredToken();
  if (!required) return true;
  const provided = (request.headers.get("x-app-token") || request.headers.get("authorization") || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  return provided === required;
};

export default async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (!isAuthorized(request)) {
    return jsonResponse({ message: "Unauthorized" }, 401);
  }

  const incoming = new URL(request.url);
  const path = stripPrefix(incoming.pathname);
  if (path !== "/" && path !== "") {
    return jsonResponse({ message: "Not found" }, 404);
  }

  const store = getStateStore();

  try {
    if (request.method === "GET" || request.method === "HEAD") {
      const entry = await readCurrentEntry(store);
      const updatedAt = entry?.metadata?.updated_at || null;
      const metaOnly = incoming.searchParams.get("meta") === "1";

      if (request.method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: {
            ...corsHeaders(),
            ...(updatedAt ? { "x-updated-at": updatedAt } : {}),
          },
        });
      }

      if (metaOnly) {
        return jsonResponse(
          { updated_at: updatedAt, has_state: Boolean(entry?.data) },
          200,
          updatedAt ? { "x-updated-at": updatedAt } : {},
        );
      }

      return jsonResponse(
        { state: entry?.data ?? null, updated_at: updatedAt },
        200,
        updatedAt ? { "x-updated-at": updatedAt } : {},
      );
    }

    if (request.method === "PUT" || request.method === "POST") {
      const rawBody = await request.text();
      if (rawBody.length > MAX_STATE_BYTES) {
        return jsonResponse(
          {
            message: "State payload too large",
            max_bytes: MAX_STATE_BYTES,
            actual_bytes: rawBody.length,
          },
          413,
        );
      }

      let body;
      try {
        body = rawBody ? JSON.parse(rawBody) : null;
      } catch {
        return jsonResponse({ message: "Invalid JSON body" }, 400);
      }

      if (!body || typeof body.state !== "object" || Array.isArray(body.state)) {
        return jsonResponse({ message: "Body must include state object" }, 400);
      }

      const expectedUpdatedAt =
        (body.expected_updated_at || request.headers.get("if-updated-at") || "").trim() || null;
      const current = await readCurrentEntry(store);
      const currentUpdatedAt = current?.metadata?.updated_at || null;

      let stateToWrite = body.state;
      let mergedOnServer = false;

      if (
        current?.data &&
        hasCoreStateShape(current.data) &&
        hasCoreStateShape(body.state) &&
        expectedUpdatedAt &&
        currentUpdatedAt &&
        expectedUpdatedAt !== currentUpdatedAt
      ) {
        const { state: merged } = mergeCollaborativeState(body.state, current.data);
        stateToWrite = merged;
        mergedOnServer = true;
      }

      if (current?.data && currentUpdatedAt) {
        const backupKey = "main:backup:latest";
        await store.setJSON(backupKey, current.data, {
          metadata: { backed_up_at: new Date().toISOString(), from_updated_at: currentUpdatedAt },
        });
      }

      const updatedAt = new Date().toISOString();
      await store.setJSON(STATE_KEY, stateToWrite, { metadata: { updated_at: updatedAt } });
      return jsonResponse(
        { updated_at: updatedAt, merged_on_server: mergedOnServer },
        200,
        { "x-updated-at": updatedAt },
      );
    }

    return jsonResponse({ message: "Method not allowed" }, 405);
  } catch (error) {
    return jsonResponse(
      { message: "Cloud state storage error", error: error?.message || "unknown" },
      500,
    );
  }
};
