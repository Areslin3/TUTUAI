import { estimateStateBytes } from "./cloudSync.js";

const CLOUD_APP_TOKEN = (import.meta.env.VITE_CLOUD_APP_TOKEN || "").trim();

const ATTACHMENT_API_URL = (() => {
  const fromEnv = (import.meta.env.VITE_CLOUD_ATTACHMENT_URL || "").trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (typeof window !== "undefined") {
    const { origin, hostname } = window.location;
    if (hostname.endsWith(".netlify.app") || hostname === "localhost" || hostname === "127.0.0.1") {
      return `${origin}/.netlify/functions/app-attachments`;
    }
  }
  return "https://beautiful-basbousa-c7556d.netlify.app/.netlify/functions/app-attachments";
})();

/** 单附件走独立 Blob；JSON 主状态仅保留元数据（Netlify 函数请求体约 6MB 上限） */
export const MAX_ATTACHMENT_BLOB_BYTES = 4 * 1024 * 1024;
export const INLINE_TO_BLOB_THRESHOLD_BYTES = 48 * 1024;

const authHeaders = () => (CLOUD_APP_TOKEN ? { "X-App-Token": CLOUD_APP_TOKEN } : {});

const attachmentRequest = async (id, options = {}) => {
  const url = `${ATTACHMENT_API_URL}?id=${encodeURIComponent(id)}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      ...authHeaders(),
      ...(options.headers || {}),
    },
  });
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
    throw new Error(payload?.message || `附件云端请求失败 (${response.status})`);
  }
  return payload || {};
};

export const saveAttachmentBlob = async (id, attachment) => {
  if (!id || !attachment?.dataUrl) return null;
  const payload = await attachmentRequest(id, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      dataUrl: attachment.dataUrl,
      name: attachment.name,
      type: attachment.type,
      size: attachment.size,
      uploadedAt: attachment.uploadedAt,
    }),
  });
  return payload?.updated_at || null;
};

export const fetchAttachmentBlob = async (id) => {
  if (!id) return null;
  const payload = await attachmentRequest(id, { method: "GET" });
  return payload?.attachment ?? null;
};

export const deleteAttachmentBlob = async (id) => {
  if (!id) return;
  try {
    await attachmentRequest(id, { method: "DELETE" });
  } catch (error) {
    console.warn("deleteAttachmentBlob failed:", error);
  }
};

const mapAttachmentList = (items, mapper) => (items || []).map(mapper);

const stripOneForCloud = (attachment) => {
  if (!attachment?.dataUrl && !attachment?.blobKey) return attachment;
  if (attachment.storage === "blob" || attachment.blobKey) {
    return {
      ...attachment,
      storage: "blob",
      blobKey: attachment.blobKey || attachment.id,
      dataUrl: "",
    };
  }
  if (attachment.dataUrl) {
    return {
      ...attachment,
      storage: "inline",
      blobKey: attachment.blobKey || "",
      dataUrl: attachment.dataUrl,
    };
  }
  return attachment;
};

const walkTasks = (tasks, fn) =>
  (tasks || []).map((task) => ({
    ...task,
    attachments: mapAttachmentList(task.attachments, fn),
    comments: (task.comments || []).map((comment) => ({
      ...comment,
      attachments: mapAttachmentList(comment.attachments, fn),
    })),
  }));

/** 写入云端前剥离 blob 附件内容，仅保留元数据与引用 */
export const stripAttachmentsForCloud = (state) => {
  if (!state) return state;
  const stripOne = stripOneForCloud;
  return {
    ...state,
    tasks: walkTasks(state.tasks, stripOne),
    trash: walkTasks(state.trash, stripOne),
    attachmentTrash: mapAttachmentList(state.attachmentTrash, stripOne),
  };
};

export const estimateCloudPayloadBytes = (state) => estimateStateBytes(stripAttachmentsForCloud(state));

const blobPayloadSize = (dataUrl) => {
  try {
    return new Blob([JSON.stringify({ dataUrl })]).size;
  } catch {
    return String(dataUrl || "").length;
  }
};

/** 将大 inline 附件迁移到独立 Blob，返回 { state, changed } */
export const migrateInlineAttachmentsToBlob = async (state, { saveBlob = saveAttachmentBlob } = {}) => {
  let changed = false;
  const migrateOne = async (attachment) => {
    if (!attachment?.dataUrl || attachment.storage === "blob" || attachment.blobKey) {
      return attachment;
    }
    const shouldMigrate =
      attachment.dataUrl.length > INLINE_TO_BLOB_THRESHOLD_BYTES ||
      blobPayloadSize(attachment.dataUrl) > INLINE_TO_BLOB_THRESHOLD_BYTES;
    if (!shouldMigrate) return attachment;

    const id = attachment.id;
    if (!id) return attachment;
    if (blobPayloadSize(attachment.dataUrl) > MAX_ATTACHMENT_BLOB_BYTES * 1.35) {
      return attachment;
    }

    await saveBlob(id, attachment);
    changed = true;
    return {
      ...attachment,
      storage: "blob",
      blobKey: id,
    };
  };

  const migrateTasks = async (tasks) => {
    const out = [];
    for (const task of tasks || []) {
      const attachments = [];
      for (const att of task.attachments || []) {
        attachments.push(await migrateOne(att));
      }
      const comments = [];
      for (const comment of task.comments || []) {
        const commentAttachments = [];
        for (const att of comment.attachments || []) {
          commentAttachments.push(await migrateOne(att));
        }
        comments.push({ ...comment, attachments: commentAttachments });
      }
      out.push({ ...task, attachments, comments });
    }
    return out;
  };

  const tasks = await migrateTasks(state.tasks);
  const trash = await migrateTasks(state.trash);
  const attachmentTrash = [];
  for (const att of state.attachmentTrash || []) {
    attachmentTrash.push(await migrateOne(att));
  }

  if (!changed) return { state, changed: false };
  return {
    state: { ...state, tasks, trash, attachmentTrash },
    changed: true,
  };
};

export const resolveAttachmentContent = async (attachment, { fetchBlob = fetchAttachmentBlob } = {}) => {
  if (!attachment) return attachment;
  if (attachment.dataUrl) return attachment;
  const key = attachment.blobKey || (attachment.storage === "blob" ? attachment.id : null);
  if (!key) return attachment;
  const blob = await fetchBlob(key);
  if (!blob?.dataUrl) return attachment;
  return { ...attachment, dataUrl: blob.dataUrl };
};

export const isAttachmentApiEnabled = () => Boolean(ATTACHMENT_API_URL);
