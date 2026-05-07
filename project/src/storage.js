import { DEFAULT_USERS, STATUSES } from "./constants.js";

const STORAGE_KEY = "tutu-deploy-progress-state-v7";
const SESSION_KEY = "tutu-deploy-progress-session-v1";

const now = () => new Date().toISOString();
const makeUuid = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `fallback-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};
const id = (prefix) => `${prefix}-${makeUuid()}`;
const TRASH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const STATUS_ALIASES = {
  待完成: "待制作",
  需修改: "待修改",
  修改已完成: "已完成",
  制作完成: "已完成",
};
const normalizeStatus = (status) => STATUS_ALIASES[status] || status || "待制作";
const statusProgress = (status) => STATUSES[normalizeStatus(status)]?.progress ?? 0;

const task = (partial) => {
  const stamp = partial.createdAt || now();
  const baseLog = {
    id: id("log"),
    taskId: partial.id,
    actor: partial.creator,
    action: `${partial.creator} 创建了任务`,
    time: stamp,
  };

  return {
    id: partial.id,
    title: partial.title,
    module: partial.module,
    description: partial.description,
    demand:
      partial.demand ||
      "请补充：当前人工操作方式、期望自动化结果、输入内容、输出结果、注意事项。",
    status: normalizeStatus(partial.status),
    progress: statusProgress(partial.status),
    priority: partial.priority,
    creator: partial.creator,
    owner: partial.owner,
    delivery: "影刀",
    createdAt: stamp,
    updatedAt: stamp,
    order: partial.order,
    dashboardOrder: partial.dashboardOrder ?? partial.order,
    attachments: partial.attachments || [],
    comments: partial.comments || [],
    logs: partial.logs || [baseLog],
  };
};

function normalizeTasks(tasks = []) {
  return tasks
    .filter((item) => String(item?.title || "").trim() !== "更换模块分区")
    .map((item, index) => {
      const status = normalizeStatus(item.status);
      const creator = item.creator || "Ares";
      const normalized = {
        ...item,
        status,
        progress: statusProgress(status),
        delivery: item.delivery || "影刀",
        dashboardOrder: item.dashboardOrder ?? index + 1,
        creator,
        owner: item.owner || creator,
        attachments: normalizeAttachments(item.attachments || [], item.id),
        comments: normalizeComments(item.comments || [], item.id),
      };

      return { ...normalized, logs: normalizeLogs(item.logs || [], normalized) };
    });
}

function purgeExpiredTrash(trash = []) {
  const cutoff = Date.now() - TRASH_RETENTION_MS;
  return (trash || []).filter((item) => {
    const deletedAt = item?.deletedAt ? new Date(item.deletedAt).getTime() : 0;
    return deletedAt && deletedAt >= cutoff;
  });
}

function normalizeTrash(trash = []) {
  const cleaned = purgeExpiredTrash(trash || []);
  return cleaned.map((item, index) => {
    const status = normalizeStatus(item.status);
    const creator = item.creator || "Ares";
    const normalized = {
      ...item,
      status,
      progress: statusProgress(status),
      delivery: item.delivery || "影刀",
      dashboardOrder: item.dashboardOrder ?? index + 1,
      creator,
      owner: item.owner || creator,
      deletedAt: item.deletedAt || now(),
      attachments: normalizeAttachments(item.attachments || [], item.id),
      comments: normalizeComments(item.comments || [], item.id),
    };

    return { ...normalized, logs: normalizeLogs(item.logs || [], normalized) };
  });
}

function normalizeAttachments(items = [], taskId = "") {
  return (items || []).map((attachment) => ({
    ...attachment,
    id: attachment.id || id("att"),
    taskId: attachment.taskId || taskId,
    name: attachment.name || "未命名附件",
    uploader: attachment.uploader || "未知用户",
    uploadedAt: attachment.uploadedAt || now(),
    type: attachment.type || "application/octet-stream",
    size: attachment.size || 0,
    dataUrl: attachment.dataUrl || "",
  }));
}

function normalizeComments(comments = [], taskId = "") {
  return (comments || []).map((comment) => ({
    ...comment,
    id: comment.id || id("comment"),
    taskId: comment.taskId || taskId,
    author: comment.author || "未知用户",
    content: comment.content || "",
    time: comment.time || now(),
    attachments: normalizeAttachments(comment.attachments || [], taskId),
  }));
}

function normalizeLogs(logs = [], task) {
  const sourceLogs = Array.isArray(logs) ? logs : [];
  const normalizedLogs = sourceLogs.map((log) => ({
    ...log,
    id: log.id || id("log"),
    taskId: log.taskId || task.id,
    actor: log.actor || task.creator || "未知用户",
    action: log.action || "更新了任务",
    time: log.time || task.updatedAt || task.createdAt || now(),
  }));

  if (!normalizedLogs.some((log) => /创建了任务/.test(String(log.action || "")))) {
    normalizedLogs.push({
      id: id("log"),
      taskId: task.id,
      actor: task.creator || "Ares",
      action: `${task.creator || "Ares"} 创建了任务`,
      time: task.createdAt || now(),
    });
  }

  return normalizedLogs.sort((a, b) => new Date(b.time) - new Date(a.time));
}

function normalizeGlobalLogs(globalLogs = [], tasks = [], trash = []) {
  const byId = new Map();
  const add = (log) => {
    if (!log) return;
    const normalized = {
      ...log,
      id: log.id || id("log"),
      actor: log.actor || "未知用户",
      action: log.action || "更新了网站",
      time: log.time || now(),
    };
    byId.set(normalized.id, normalized);
  };

  (globalLogs || []).forEach(add);
  [...tasks, ...trash].forEach((item) => (item.logs || []).forEach(add));
  return [...byId.values()].sort((a, b) => new Date(b.time) - new Date(a.time));
}

function normalizeAttachmentTrash(items = []) {
  const cleaned = purgeExpiredTrash(items || []);
  return cleaned.map((item) => ({
    ...item,
    deletedAt: item.deletedAt || now(),
    uploader: item.uploader || "未知用户",
    sourceType: item.sourceType || "task",
  }));
}

const makeInitialState = () => {
  const createdAt = "2026-04-01T10:30:00.000Z";
  const tasks = [
    task({
      id: "task-customs-1",
      title: "兔兔DO",
      module: "关务",
      description: "兔兔 DO 流程已完成。",
      demand: "兔兔DO 显示已完成。",
      status: "已完成",
      priority: "P0",
      creator: "Ares",
      owner: "Ares",
      delivery: "网站功能",
      createdAt,
      order: 1,
    }),
    task({
      id: "task-customs-2",
      title: "MC DO",
      module: "关务",
      description: "MC DO 流程已完成。",
      demand: "MC DO 显示已完成。",
      status: "已完成",
      priority: "P1",
      creator: "Ares",
      owner: "Ares",
      delivery: "网站功能",
      createdAt: "2026-04-02T14:20:00.000Z",
      order: 2,
    }),
    task({
      id: "task-customs-3",
      title: "EPS DO",
      module: "关务",
      description: "EPS DO 流程已完成。",
      demand: "EPS DO 显示已完成。",
      status: "已完成",
      priority: "P1",
      creator: "Ares",
      owner: "Ares",
      delivery: "网站功能",
      createdAt: "2026-04-02T10:00:00.000Z",
      order: 3,
    }),
    task({
      id: "task-customs-4",
      title: "更新清关时间",
      module: "关务",
      description: "更新清关时间流程已完成。",
      demand: "更新清关时间显示已完成。",
      status: "已完成",
      priority: "P1",
      creator: "Ares",
      owner: "Ares",
      delivery: "网站功能",
      createdAt: "2026-04-03T11:30:00.000Z",
      order: 4,
    }),
    task({
      id: "task-customs-5",
      title: "核对DO流程",
      module: "关务",
      description: "核对 DO 流程待制作。",
      demand: "核对DO流程待制作，放到关务里。",
      status: "待制作",
      priority: "P2",
      creator: "Ares",
      owner: "Ares",
      delivery: "网站功能",
      createdAt: "2026-04-03T14:30:00.000Z",
      order: 5,
    }),
    task({
      id: "task-customs-6",
      title: "更新DO",
      module: "关务",
      description: "更新 DO 流程待制作。",
      demand: "关务里增加更新DO任务，状态待制作。",
      status: "待制作",
      priority: "P1",
      creator: "Ares",
      owner: "Ares",
      delivery: "网站功能",
      createdAt: "2026-04-03T16:00:00.000Z",
      order: 6,
    }),
    task({
      id: "task-ops-1",
      title: "填写ATA",
      module: "操作",
      description: "填写 ATA 需要修改。",
      demand: "填写ATA显示待修改。",
      status: "待修改",
      priority: "P0",
      creator: "Ares",
      owner: "Ares",
      delivery: "网站功能",
      createdAt: "2026-04-04T09:00:00.000Z",
      order: 1,
    }),
    task({
      id: "task-ops-2",
      title: "填写派送时间",
      module: "操作",
      description: "填写派送时间需要修改。",
      demand: "填写派送时间待修改。",
      status: "待修改",
      priority: "P0",
      creator: "Ares",
      owner: "Ares",
      delivery: "网站功能",
      createdAt: "2026-04-04T10:00:00.000Z",
      order: 2,
    }),
    task({
      id: "task-ops-3",
      title: "上传POD",
      module: "操作",
      description: "上传 POD 已完成。",
      demand: "上传POD已完成。",
      status: "已完成",
      priority: "P1",
      creator: "Ares",
      owner: "Ares",
      delivery: "网站功能",
      createdAt: "2026-04-04T11:00:00.000Z",
      order: 3,
    }),
    task({
      id: "task-ops-4",
      title: "更改整柜提单",
      module: "操作",
      description: "更改整柜提单已完成。",
      demand: "更改整柜提单显示已完成。",
      status: "已完成",
      priority: "P1",
      creator: "Ares",
      owner: "Ares",
      delivery: "网站功能",
      createdAt: "2026-04-04T12:00:00.000Z",
      order: 4,
    }),
    task({
      id: "task-ops-5",
      title: "更改散货提单",
      module: "操作",
      description: "更改散货提单已完成。",
      demand: "更改散货提单显示已完成。",
      status: "已完成",
      priority: "P1",
      creator: "Ares",
      owner: "Ares",
      delivery: "网站功能",
      createdAt: "2026-04-04T13:00:00.000Z",
      order: 5,
    }),
    task({
      id: "task-ops-6",
      title: "更改约派提单",
      module: "操作",
      description: "更改约派提单待制作。",
      demand: "操作里增加更改约派提单，状态待制作。",
      status: "待制作",
      priority: "P2",
      creator: "Ares",
      owner: "Ares",
      delivery: "网站功能",
      createdAt: "2026-04-04T14:00:00.000Z",
      order: 6,
    }),
    task({
      id: "task-service-1",
      title: "待制作POD和提单的下载",
      module: "客服",
      description: "待制作的 POD 和提单下载功能。",
      demand: "增加待制作POD和提单的下载待制作，放到客服里。",
      status: "待制作",
      priority: "P2",
      creator: "Ares",
      owner: "Ares",
      delivery: "网站功能",
      createdAt: "2026-04-05T09:00:00.000Z",
      order: 1,
    }),
    task({
      id: "task-service-2",
      title: "POD获取",
      module: "客服",
      description: "POD获取待制作。",
      demand: "客服里加一个 POD 获取待制作状态。",
      status: "待制作",
      priority: "P2",
      creator: "Ares",
      owner: "Ares",
      delivery: "网站功能",
      createdAt: "2026-04-05T10:00:00.000Z",
      order: 2,
    }),
    task({
      id: "task-other-1",
      title: "表格拆分PDF",
      module: "其他",
      description: "表格拆分 PDF 已完成。",
      demand: "表格拆分PDF显示已完成。",
      status: "已完成",
      priority: "P1",
      creator: "Ares",
      owner: "Ares",
      delivery: "网站功能",
      createdAt: "2026-04-05T09:20:00.000Z",
      order: 1,
    }),
  ];

  const normalizedTasks = normalizeTasks(tasks);
  const globalLogs = normalizedTasks.flatMap((item) => item.logs);
  return { users: DEFAULT_USERS, tasks: normalizedTasks, trash: [], attachmentTrash: [], globalLogs };
};

export const buildInitialState = () => makeInitialState();

const normalizeUsers = (users = []) => {
  const byName = new Map();
  const source = users.length ? users : DEFAULT_USERS;
  for (const user of source) {
    if (!user?.username) continue;
    const username = String(user.username).trim();
    if (!username || byName.has(username.toLowerCase())) continue;
    byName.set(username.toLowerCase(), {
      ...user,
      username,
      role: username === "Ares" ? "管理员" : "用户",
      tutorialDone: typeof user.tutorialDone === "boolean" ? user.tutorialDone : username === "Ares",
    });
  }
  if (!byName.has("ares")) byName.set("ares", DEFAULT_USERS[0]);
  return [...byName.values()].sort((a, b) => (a.username === "Ares" ? -1 : b.username === "Ares" ? 1 : a.username.localeCompare(b.username)));
};

export const normalizeState = (state) => {
  const parsed = state || {};
  const normalizedTrash = normalizeTrash(parsed.trash || []);
  const normalizedTasks = normalizeTasks(parsed.tasks || []);
  const normalizedUsers = normalizeUsers(parsed.users || []);
  return {
    users: normalizedUsers,
    tasks: normalizedTasks,
    trash: normalizedTrash,
    attachmentTrash: normalizeAttachmentTrash(parsed.attachmentTrash || []),
    globalLogs: normalizeGlobalLogs(parsed.globalLogs || [], normalizedTasks, normalizedTrash),
  };
};

const tryWriteStore = (payload) => {
  try {
    localStorage.setItem(STORAGE_KEY, typeof payload === "string" ? payload : JSON.stringify(payload));
    return true;
  } catch (e) {
    console.error("localStorage write failed:", e);
    return false;
  }
};

export const loadState = () => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const initial = makeInitialState();
    tryWriteStore(initial);
    return initial;
  }

  try {
    const parsed = JSON.parse(raw);
    const normalized = normalizeState(parsed);
    tryWriteStore(normalized);
    return normalized;
  } catch {
    const initial = makeInitialState();
    tryWriteStore(initial);
    return initial;
  }
};

/** @returns {boolean} false = 配额满或写入失败，不应再抛错以免整页崩溃 */
export const saveState = (state) => {
  try {
    const normalized = normalizeState(state);
    return tryWriteStore(normalized);
  } catch (e) {
    console.error("saveState failed:", e);
    return false;
  }
};

export const loadSession = () => {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw);
    if (session?.username) {
      return { ...session, role: session.username === "Ares" ? "管理员" : "用户" };
    }
  } catch {
    // Ignore invalid session state.
  }
  localStorage.removeItem(SESSION_KEY);
  return null;
};

export const saveSession = (user) => {
  localStorage.setItem(SESSION_KEY, JSON.stringify(user));
};

export const clearSession = () => {
  localStorage.removeItem(SESSION_KEY);
};

export const makeId = id;
export const timestamp = now;
