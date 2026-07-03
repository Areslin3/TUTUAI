/** 多人协作合并（客户端 + Netlify 服务端共用） */

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

const mergeAttachmentRecord = (local, remote) => {
  const pickRemote = new Date(remote.uploadedAt || 0) >= new Date(local.uploadedAt || 0);
  const base = pickRemote ? { ...local, ...remote } : { ...remote, ...local };
  const dataUrl = base.dataUrl || local.dataUrl || remote.dataUrl || "";
  const blobKey = base.blobKey || local.blobKey || remote.blobKey || "";
  let storage = base.storage || local.storage || remote.storage || "inline";
  if (blobKey && !dataUrl) storage = "blob";
  else if (dataUrl && !blobKey) storage = "inline";
  else if (blobKey && dataUrl) storage = pickRemote ? remote.storage || "blob" : local.storage || "blob";
  return { ...base, dataUrl, blobKey, storage };
};

const mergeAttachments = (localArr, remoteArr) => {
  const m = byIdMap(localArr);
  for (const r of remoteArr || []) {
    if (!r?.id) continue;
    if (!m.has(r.id)) {
      m.set(r.id, r);
      continue;
    }
    m.set(r.id, mergeAttachmentRecord(m.get(r.id), r));
  }
  return [...m.values()].sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0));
};

const mergeComments = (localArr, remoteArr) => {
  const m = byIdMap(localArr);
  for (const r of remoteArr || []) {
    if (!r?.id) continue;
    if (!m.has(r.id)) {
      m.set(r.id, { ...r, attachments: mergeAttachments(r.attachments || [], []) });
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

const lifecycleTime = (item) =>
  Math.max(
    new Date(item?.updatedAt || 0).getTime() || 0,
    new Date(item?.deletedAt || 0).getTime() || 0,
    new Date(item?.createdAt || 0).getTime() || 0,
  );

const listSig = (arr) =>
  JSON.stringify(
    [...(arr || [])]
      .map((x) => [x?.id || "", x?.updatedAt || "", x?.deletedAt || ""])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  );

const tombstoneSig = (arr) =>
  JSON.stringify(
    [...(arr || [])]
      .map((x) => [x?.taskId || x?.id || "", x?.deletedAt || x?.time || ""])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  );

/** 任务标量字段：按 updatedAt 做 Last-Write-Wins，避免多用户同时改不同字段时整包偏向一方 */
const mergeTaskScalarsLWW = (localTask, remoteTask) => {
  const remoteNewer = new Date(remoteTask.updatedAt || 0) > new Date(localTask.updatedAt || 0);
  return remoteNewer ? { ...localTask, ...remoteTask } : { ...remoteTask, ...localTask };
};

const mergeTaskPayload = (localTask, remoteTask) => {
  const scalarBase = mergeTaskScalarsLWW(localTask, remoteTask);
  const at = mergeAttachments(localTask.attachments || [], remoteTask.attachments || []);
  const cm = mergeComments(localTask.comments || [], remoteTask.comments || []);
  const lg = mergeLogs(localTask.logs || [], remoteTask.logs || []);
  const changed =
    idSig(at) !== idSig(localTask.attachments) ||
    idSig(cm) !== idSig(localTask.comments) ||
    idSig(lg) !== idSig(localTask.logs) ||
    scalarBase.title !== localTask.title ||
    scalarBase.status !== localTask.status ||
    scalarBase.description !== localTask.description;
  return {
    ...scalarBase,
    attachments: at,
    comments: cm,
    logs: lg,
    updatedAt: maxIso(localTask.updatedAt, remoteTask.updatedAt),
    _mergeChanged: changed,
  };
};

const mergeTaskKeepingBase = (base, other) => {
  const merged = mergeTaskPayload(base, other || {});
  delete merged._mergeChanged;
  return merged;
};

const reconcileActiveAndTrash = (tasks, trash) => {
  const beforeTaskSig = listSig(tasks);
  const beforeTrashSig = listSig(trash);
  const activeById = byIdMap(tasks || []);
  const trashById = byIdMap(trash || []);

  for (const [taskId, activeTask] of activeById) {
    const trashedTask = trashById.get(taskId);
    if (!trashedTask) continue;

    if (lifecycleTime(trashedTask) >= lifecycleTime(activeTask)) {
      activeById.delete(taskId);
      trashById.set(taskId, {
        ...mergeTaskKeepingBase(trashedTask, activeTask),
        deletedAt: trashedTask.deletedAt || trashedTask.updatedAt,
      });
    } else {
      trashById.delete(taskId);
      const restored = mergeTaskKeepingBase(activeTask, trashedTask);
      delete restored.deletedAt;
      activeById.set(taskId, restored);
    }
  }

  const reconciledTasks = [...activeById.values()];
  const reconciledTrash = [...trashById.values()];
  return {
    tasks: reconciledTasks,
    trash: reconciledTrash,
    changed: beforeTaskSig !== listSig(reconciledTasks) || beforeTrashSig !== listSig(reconciledTrash),
  };
};

const extractTombstonesFromLogs = (logs) =>
  (logs || [])
    .filter((log) => log?.taskId && String(log.action || "").includes("彻底删除了任务"))
    .map((log) => ({
      taskId: log.taskId,
      deletedAt: log.time,
      actor: log.actor,
      title: String(log.action || "").match(/「(.+)」/)?.[1] || "",
    }));

const mergeDeletedTaskTombstones = (localArr, remoteArr, globalLogs = []) => {
  const before = tombstoneSig(localArr);
  const byTaskId = new Map();
  const add = (item) => {
    const taskId = item?.taskId || item?.id;
    if (!taskId) return;
    const deletedAt = item.deletedAt || item.time;
    if (!deletedAt) return;
    const tombstone = {
      taskId,
      deletedAt,
      actor: item.actor || "未知用户",
      title: item.title || item.taskTitle || "",
    };
    const existing = byTaskId.get(taskId);
    if (!existing || new Date(tombstone.deletedAt) >= new Date(existing.deletedAt)) {
      byTaskId.set(taskId, tombstone);
    }
  };

  (localArr || []).forEach(add);
  (remoteArr || []).forEach(add);
  extractTombstonesFromLogs(globalLogs).forEach(add);

  const deletedTaskTombstones = [...byTaskId.values()].sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
  return {
    deletedTaskTombstones,
    changed: before !== tombstoneSig(deletedTaskTombstones),
  };
};

const applyDeletedTaskTombstones = (tasks, trash, tombstones) => {
  const beforeTaskSig = listSig(tasks);
  const beforeTrashSig = listSig(trash);
  const deletedIds = new Set((tombstones || []).map((item) => item?.taskId).filter(Boolean));
  if (!deletedIds.size) return { tasks, trash, changed: false };

  const filteredTasks = (tasks || []).filter((task) => !deletedIds.has(task?.id));
  const filteredTrash = (trash || []).filter((task) => !deletedIds.has(task?.id));
  return {
    tasks: filteredTasks,
    trash: filteredTrash,
    changed: beforeTaskSig !== listSig(filteredTasks) || beforeTrashSig !== listSig(filteredTrash),
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

  const { deletedTaskTombstones, changed: dc } = mergeDeletedTaskTombstones(
    local.deletedTaskTombstones || [],
    remote.deletedTaskTombstones || [],
    globalLogs,
  );
  if (dc) changed = true;

  const reconciled = reconcileActiveAndTrash(tasks, trash);
  if (reconciled.changed) changed = true;
  const filtered = applyDeletedTaskTombstones(reconciled.tasks, reconciled.trash, deletedTaskTombstones);
  if (filtered.changed) changed = true;

  return {
    state: {
      ...local,
      tasks: filtered.tasks,
      users,
      trash: filtered.trash,
      attachmentTrash,
      deletedTaskTombstones,
      globalLogs,
    },
    changed,
  };
}

/** 入站与出站现使用同一套 LWW + 集合并集逻辑，避免方向不对称导致的多用户丢改 */
export function mergeInboundCollaborativeState(prev, remote) {
  const { state, changed } = mergeCollaborativeState(prev, remote);
  return { state, changed };
}
