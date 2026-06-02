import { getStore } from "@netlify/blobs";

const STATE_KEY = "main";
const PATH_PREFIXES = ["/.netlify/functions/app-state", "/api/app-state"];

const corsHeaders = () => ({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, x-app-token",
  "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
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

export default async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  const incoming = new URL(request.url);
  const path = stripPrefix(incoming.pathname);
  if (path !== "/" && path !== "") {
    return new Response(JSON.stringify({ message: "Not found" }), {
      status: 404,
      headers: { ...corsHeaders(), "Content-Type": "application/json" },
    });
  }

  const store = getStateStore();

  try {
    if (request.method === "GET") {
      const entry = await store.getWithMetadata(STATE_KEY, { type: "json" });
      const updatedAt = entry?.metadata?.updated_at || null;
      return new Response(
        JSON.stringify({
          state: entry?.data ?? null,
          updated_at: updatedAt,
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders(),
            "Content-Type": "application/json",
            ...(updatedAt ? { "x-updated-at": updatedAt } : {}),
          },
        },
      );
    }

    if (request.method === "PUT" || request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch {
        return new Response(JSON.stringify({ message: "Invalid JSON body" }), {
          status: 400,
          headers: { ...corsHeaders(), "Content-Type": "application/json" },
        });
      }

      if (!body || typeof body.state !== "object" || Array.isArray(body.state)) {
        return new Response(JSON.stringify({ message: "Body must include state object" }), {
          status: 400,
          headers: { ...corsHeaders(), "Content-Type": "application/json" },
        });
      }

      const updatedAt = new Date().toISOString();
      await store.setJSON(STATE_KEY, body.state, { metadata: { updated_at: updatedAt } });
      return new Response(JSON.stringify({ updated_at: updatedAt }), {
        status: 200,
        headers: {
          ...corsHeaders(),
          "Content-Type": "application/json",
          "x-updated-at": updatedAt,
        },
      });
    }

    return new Response(JSON.stringify({ message: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders(), "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ message: "Cloud state storage error", error: error?.message || "unknown" }),
      { status: 500, headers: { ...corsHeaders(), "Content-Type": "application/json" } },
    );
  }
};
