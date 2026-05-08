/** 多人协作：把远端状态合并进即将保存的本地状态，避免「后保存覆盖」导致他人附件/留言消失 */

const maxIso = (a, b) => {
  const ta = new Date(a || 0).getTime();
  const tb = new Date(b || 0).getTime();
  return tb >= ta ? b : a;
};

const byIdMap = (items, getId = (x) => x.id) => {
  const m = new Map();
  for (const x of items || []) {
    const id = getId(x);
    if (id != null && id !== "") m.set(id, x);
  }
  return m;
};

const mergeAttachments = (localArr, remoteArr) => {
  const m = byIdMap(localArr);
  for (const r of remoteArr || []) {
    if (!r?.id) continue;
    if (!m.has(r.id)) {
      m.set(r.id, r);
      continue;
    }
    const l = m.get(r.id);
    m.set(r.id, new Date(r.uploadedAt || 0) >= new Date(l.uploadedAt || 0) ? { ...l, ...r } : { ...r, ...l });
  }
  return [...m.values()].sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0));
};

const mergeComments = (localArr, remoteArr) => {
  const m = byIdMap(localArr);
  for (const r of remoteArr || []) {
    if (!r?.id) continue;
    if (!m.has(r.id)) {
      m.set(r.id, {
        ...r,
        attachments: mergeAttachments(r.attachments || [], []),
      });
      continue;
    }
    const l = m.get(r.id);
    const pickRemote = new Date(r.time || 0) >= new Date(l.time || 0);
    const base = pickRemote ? { ...l, ...r } : { ...r, ...l };
    m.set(r.id, {
      ...base,
      attachments: mergeAttachments(l.attachments || [], r.attachments || []),
      time: maxIso(l.time, r.time),
    });
  }
  return [...m.values()].sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));
};

const mergeLogs = (localArr, remoteArr) => {
  const m = byIdMap(localArr);
  for (const r of remoteArr || []) {
    if (!r?.id) continue;
    if (!m.has(r.id)) m.set(r.id, r);
  }
  return [...m.values()].sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));
};

const idSig = (arr) =>
  [...(arr || [])]
    .map((x) => x?.id)
    .filter(Boolean)
    .sort()
    .join("|");

/** 出站保存：本地改动优先合并远端多出的附件/留言/日志 */
const mergeTaskPayload = (localTask, remoteTask) => {
  const at = mergeAttachments(localTask.attachments || [], remoteTask.attachments || []);
  const cm = mergeComments(localTask.comments || [], remoteTask.comments || []);
  const lg = mergeLogs(localTask.logs || [], remoteTask.logs || []);
  const changed =
    idSig(at) !== idSig(localTask.attachments) ||
    idSig(cm) !== idSig(localTask.comments) ||
    idSig(lg) !== idSig(localTask.logs);
  return {
    ...localTask,
    attachments: at,
    comments: cm,
    logs: lg,
    updatedAt: maxIso(localTask.updatedAt, remoteTask.updatedAt),
    _mergeChanged: changed,
  };
};

/** 入站拉取：远端任务主字段（标题、状态等）为准，同时并入本地尚未上传完的附件/留言/日志 */
const mergeInboundTaskPayload = (localTask, remoteTask) => {
  const at = mergeAttachments(localTask.attachments || [], remoteTask.attachments || []);
  const cm = mergeComments(localTask.comments || [], remoteTask.comments || []);
  const lg = mergeLogs(localTask.logs || [], remoteTask.logs || []);
  return {
    ...remoteTask,
    attachments: at,
    comments: cm,
    logs: lg,
    updatedAt: maxIso(localTask.updatedAt, remoteTask.updatedAt),
  };
};

const mergeTaskList = (localTasks, remoteTasks) => {
  const remoteById = byIdMap(remoteTasks);
  let changed = false;
  const out = [];
  const seen = new Set();

  for (const lt of localTasks || []) {
    if (!lt?.id) continue;
    seen.add(lt.id);
    const rt = remoteById.get(lt.id);
    if (!rt) {
      out.push(lt);
      continue;
    }
    const merged = mergeTaskPayload(lt, rt);
    if (merged._mergeChanged) changed = true;
    delete merged._mergeChanged;
    out.push(merged);
  }

  for (const rt of remoteTasks || []) {
    if (!rt?.id || seen.has(rt.id)) continue;
    out.push(rt);
    changed = true;
  }

  return { tasks: out, changed };
};

const mergeInboundTaskList = (localTasks, remoteTasks) => {
  const localById = byIdMap(localTasks);
  const out = [];
  const seen = new Set();

  for (const rt of remoteTasks || []) {
    if (!rt?.id) continue;
    seen.add(rt.id);
    const lt = localById.get(rt.id);
    out.push(lt ? mergeInboundTaskPayload(lt, rt) : rt);
  }

  for (const lt of localTasks || []) {
    if (!lt?.id || seen.has(lt.id)) continue;
    out.push(lt);
  }

  return { tasks: out };
};

const mergeUsers = (localUsers, remoteUsers) => {
  const m = new Map();
  for (const u of remoteUsers || []) {
    if (u?.id) m.set(u.id, { ...u });
  }
  for (const u of localUsers || []) {
    if (!u?.id) continue;
    if (!m.has(u.id)) m.set(u.id, { ...u });
    else m.set(u.id, { ...m.get(u.id), ...u });
  }
  const list = [...m.values()];
  const sig = (arr) =>
    [...(arr || [])]
      .map((u) => u?.id)
      .filter(Boolean)
      .sort()
      .join("|");
  return { users: list, changed: sig(list) !== sig(localUsers) };
};

const mergeTrashLists = (localTrash, remoteTrash) => mergeTaskList(localTrash || [], remoteTrash || []);

const mergeAttachmentTrash = (localArr, remoteArr) => {
  const m = byIdMap(localArr);
  for (const r of remoteArr || []) {
    if (!r?.id) continue;
    if (!m.has(r.id)) m.set(r.id, r);
  }
  const list = [...m.values()];
  return {
    attachmentTrash: list,
    changed: list.length !== (localArr || []).length,
  };
};

const mergeGlobalLogs = (localArr, remoteArr) => {
  const m = byIdMap(localArr);
  for (const r of remoteArr || []) {
    if (!r?.id) continue;
    if (!m.has(r.id)) m.set(r.id, r);
  }
  const list = [...m.values()].sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));
  return { globalLogs: list, changed: list.length !== (localArr || []).length };
};

/**
 * 以 local 为主（保留当前用户刚改的字段），同时并入 remote 中多出的附件、留言、日志、用户等。
 * @returns {{ state: object, changed: boolean }}
 */
export function mergeCollaborativeState(local, remote) {
  if (!remote || !Array.isArray(remote.tasks) || !Array.isArray(local?.tasks)) {
    return { state: local, changed: false };
  }

  let changed = false;
  const { tasks, changed: tc } = mergeTaskList(local.tasks, remote.tasks);
  if (tc) changed = true;

  const { users, changed: uc } = mergeUsers(local.users || [], remote.users || []);
  if (uc) changed = true;

  const { tasks: trash, changed: trc } = mergeTrashLists(local.trash || [], remote.trash || []);
  if (trc) changed = true;

  const { attachmentTrash, changed: ac } = mergeAttachmentTrash(local.attachmentTrash || [], remote.attachmentTrash || []);
  if (ac) changed = true;

  const { globalLogs, changed: gc } = mergeGlobalLogs(local.globalLogs || [], remote.globalLogs || []);
  if (gc) changed = true;

  return {
    state: {
      ...local,
      tasks,
      users,
      trash,
      attachmentTrash,
      globalLogs,
    },
    changed,
  };
}

/**
 * 从云端拉取后合并到当前页：每个任务以 **remote 主字段** 为准，再并上双方附件/留言/日志。
 * 仅用于 Realtime/轮询/回页触发的入站拉取，与 mergeCollaborativeState（出站保存前）方向相反。
 */
export function mergeInboundCollaborativeState(prev, remote) {
  if (!remote || !Array.isArray(remote.tasks) || !Array.isArray(prev?.tasks)) {
    return { state: prev };
  }

  const { tasks } = mergeInboundTaskList(prev.tasks, remote.tasks);
  const { users } = mergeUsers(prev.users || [], remote.users || []);
  const { tasks: trash } = mergeInboundTaskList(prev.trash || [], remote.trash || []);
  const { attachmentTrash } = mergeAttachmentTrash(prev.attachmentTrash || [], remote.attachmentTrash || []);
  const { globalLogs } = mergeGlobalLogs(prev.globalLogs || [], remote.globalLogs || []);

  return {
    state: {
      ...prev,
      tasks,
      users,
      trash,
      attachmentTrash,
      globalLogs,
    },
  };
}
