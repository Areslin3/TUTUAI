import { getStore } from "@netlify/blobs";

const STORE_NAME = "tutu-app-attachments";
/** Netlify 同步函数请求体约 6MB；JSON 内 dataUrl 留余量 */
const MAX_ATTACHMENT_BYTES = 4.5 * 1024 * 1024;

const corsHeaders = () => ({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, x-app-token",
  "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS, HEAD",
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

const getAttachmentStore = () =>
  getStore({
    name: STORE_NAME,
    consistency: "strong",
  });

const getRequiredToken = () => (process.env.APP_STATE_TOKEN || "").trim();

const isAuthorized = (request) => {
  const required = getRequiredToken();
  if (!required) return true;
  const provided = (request.headers.get("x-app-token") || request.headers.get("authorization") || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  return provided === required;
};

const sanitizeAttachmentId = (value) => {
  const id = String(value || "").trim();
  if (!id || id.length > 200 || id.includes("/") || id.includes("..")) return null;
  return id;
};

export default async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (!isAuthorized(request)) {
    return jsonResponse({ message: "Unauthorized" }, 401);
  }

  const incoming = new URL(request.url);
  const attachmentId = sanitizeAttachmentId(incoming.searchParams.get("id"));
  if (!attachmentId) {
    return jsonResponse({ message: "Query parameter id is required" }, 400);
  }

  const store = getAttachmentStore();
  const blobKey = `att:${attachmentId}`;

  try {
    if (request.method === "GET" || request.method === "HEAD") {
      const entry = await store.getWithMetadata(blobKey, { type: "json" });
      if (request.method === "HEAD") {
        return new Response(null, {
          status: entry?.data ? 200 : 404,
          headers: corsHeaders(),
        });
      }
      if (!entry?.data) {
        return jsonResponse({ message: "Attachment not found" }, 404);
      }
      return jsonResponse({ attachment: entry.data, updated_at: entry.metadata?.updated_at ?? null }, 200);
    }

    if (request.method === "DELETE") {
      await store.delete(blobKey);
      return jsonResponse({ deleted: true, id: attachmentId }, 200);
    }

    if (request.method === "PUT" || request.method === "POST") {
      const rawBody = await request.text();
      if (rawBody.length > MAX_ATTACHMENT_BYTES) {
        return jsonResponse(
          {
            message: "Attachment payload too large",
            max_bytes: MAX_ATTACHMENT_BYTES,
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

      if (!body || typeof body !== "object" || !body.dataUrl) {
        return jsonResponse({ message: "Body must include dataUrl" }, 400);
      }

      const updatedAt = new Date().toISOString();
      const record = {
        id: attachmentId,
        dataUrl: body.dataUrl,
        name: body.name || "未命名附件",
        type: body.type || "application/octet-stream",
        size: body.size || 0,
        uploadedAt: body.uploadedAt || updatedAt,
      };

      await store.setJSON(blobKey, record, { metadata: { updated_at: updatedAt } });
      return jsonResponse({ id: attachmentId, updated_at: updatedAt }, 200);
    }

    return jsonResponse({ message: "Method not allowed" }, 405);
  } catch (error) {
    return jsonResponse(
      { message: "Attachment storage error", error: error?.message || "unknown" },
      500,
    );
  }
};
