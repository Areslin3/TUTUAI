import { createClient } from "@supabase/supabase-js";

/** 内置项目云端（Supabase anon key 本身设计为可公开，权限靠 RLS 约束） */
const DEFAULT_SUPABASE_URL = "https://lnkvkkgwofjgszsgpetk.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY =
  "sb_publishable_cDc-WkiRX25lyYhCqsJOBQ_Qr0HZKKa";

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL || "").trim();
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY || "").trim();

const TABLE_NAME = "app_state";
const STATE_ROW_ID = "main";

let client = null;

const getClient = () => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });
  }
  return client;
};

export const isCloudSyncEnabled = () => Boolean(getClient());

export const fetchCloudStateWithMeta = async () => {
  const supabase = getClient();
  if (!supabase) return { state: null, updatedAt: null };

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select("state, updated_at")
    .eq("id", STATE_ROW_ID)
    .maybeSingle();

  if (error) throw error;
  return { state: data?.state ?? null, updatedAt: data?.updated_at ?? null };
};

export const fetchCloudState = async () => {
  const { state } = await fetchCloudStateWithMeta();
  return state;
};

export const fetchCloudUpdatedAt = async () => {
  const supabase = getClient();
  if (!supabase) return null;

  const { data, error } = await supabase.from(TABLE_NAME).select("updated_at").eq("id", STATE_ROW_ID).maybeSingle();

  if (error) throw error;
  return data?.updated_at ?? null;
};

export const saveCloudState = async (state) => {
  const supabase = getClient();
  if (!supabase) return null;

  const payload = {
    id: STATE_ROW_ID,
    state,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from(TABLE_NAME).upsert(payload, { onConflict: "id" });
  if (error) throw error;
  return payload.updated_at;
};

/**
 * 订阅 app_state 行变更（需在 Supabase 为 app_state 开启 Replication）。
 * @param {() => void} onChange — 收到通知后请自行 fetch 全量 state
 * @returns {() => void} 取消订阅
 */
export const subscribeAppStateRemoteChanges = (onChange, onStatus) => {
  const supabase = getClient();
  if (!supabase) return () => {};

  const channel = supabase
    .channel("app_state_main_collab")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: TABLE_NAME,
        filter: `id=eq.${STATE_ROW_ID}`,
      },
      () => {
        onChange();
      },
    )
    .subscribe((status) => {
      onStatus?.(status);
    });

  return () => {
    supabase.removeChannel(channel);
  };
};
