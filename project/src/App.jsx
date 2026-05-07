import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import {
  Activity,
  ArrowUpDown,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Clock3,
  Download,
  Edit3,
  ExternalLink,
  Eye,
  FilePlus2,
  Files,
  Filter,
  Gauge,
  GripVertical,
  LayoutDashboard,
  LogOut,
  MessageSquareText,
  Paperclip,
  Plus,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { MODULES, STATUSES } from "./constants.js";
import {
  buildInitialState,
  clearSession,
  loadSession,
  loadState,
  makeId,
  normalizeState,
  saveSession,
  saveState,
  timestamp,
} from "./storage.js";
import {
  fetchCloudStateWithMeta,
  fetchCloudUpdatedAt,
  isCloudSyncEnabled,
  saveCloudState,
  subscribeAppStateRemoteChanges,
} from "./cloudSync.js";
import { mergeCollaborativeState } from "./collabMerge.js";

const formatTime = (value) =>
  new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

const statusClass = (status) => `status status-${STATUSES[status]?.color || "gray"}`;
const statusProgress = (status) => STATUSES[status]?.progress ?? 0;

const buildLatestSituation = (task) => {
  const latest = [...(task.logs || [])].sort((a, b) => new Date(b.time) - new Date(a.time))[0];
  if (latest) return latest.action;
  if (task.description) return task.description;
  return "等待处理";
};

const trackedRecentLog = (log) => {
  if (!log) return false;
  const action = String(log.action || "");
  const hasStatusChange = Boolean(log.details?.changes?.status);
  const isComment = action.includes("留言：");
  const isAttachmentUpload = action.includes("上传了") && action.includes("附件");
  const isCreated = action.includes("创建了任务");
  return hasStatusChange || isComment || isAttachmentUpload || isCreated;
};

const buildRecentUpdateSummary = (log) => {
  if (!log) return "";
  const action = String(log.action || "");
  const statusBefore = log.details?.before?.status;
  const statusAfter = log.details?.after?.status;
  if (statusBefore && statusAfter && statusBefore !== statusAfter) {
    return `状态变更：${statusBefore} -> ${statusAfter}`;
  }
  if (action.includes("留言：")) {
    const [, commentText = ""] = action.split("留言：");
    return `留言更新：${commentText}`;
  }
  if (action.includes("上传了") && action.includes("附件")) {
    return action.replace(/^.*?\s+/, "");
  }
  if (action.includes("创建了任务")) {
    return "新建任务";
  }
  return action;
};

const isOrderAdjustAction = (action) =>
  /调整了任务制作顺序|拖动调整了任务制作顺序|调整了仪表盘任务制作顺序|拖动调整了仪表盘任务制作顺序/.test(
    String(action || ""),
  );
const SCROLLBAR_OPTIONS = {
  overflow: { x: "hidden", y: "scroll" },
  scrollbars: {
    theme: "os-theme-light",
    autoHide: "never",
    dragScroll: true,
    clickScroll: true,
    pointers: ["mouse", "touch", "pen"],
  },
};
const TIMELINE_SCROLLBAR_OPTIONS = {
  overflow: { x: "hidden", y: "scroll" },
  scrollbars: {
    theme: "os-theme-light",
    autoHide: "never",
    dragScroll: true,
    clickScroll: true,
    pointers: ["mouse", "touch", "pen"],
  },
};

const canPreviewAttachment = (attachment) => {
  const type = attachment.type || "";
  const name = attachment.name || "";
  return (
    type.startsWith("image/") ||
    type.startsWith("video/") ||
    type.startsWith("text/") ||
    type === "application/pdf" ||
    /\.(txt|csv|md|log)$/i.test(name)
  );
};

const cinematicMotion = {
  initial: { opacity: 0, y: 30, filter: "blur(10px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  transition: { type: "spring", bounce: 0, duration: 0.8 },
};

const normalizeSearch = (value) => String(value || "").toLowerCase().replace(/\s+/g, "");
const hasCoreStateShape = (state) =>
  Boolean(state) && Array.isArray(state.users) && Array.isArray(state.tasks);
const isEmptyCoreState = (state) =>
  hasCoreStateShape(state) && state.users.length === 0 && state.tasks.length === 0;
const stateRevision = (state) =>
  JSON.stringify({
    users: (state?.users || []).map((user) => [user.id, user.username, user.role]),
    tasks: (state?.tasks || []).map((task) => [
      task.id,
      task.title,
      task.module,
      task.status,
      task.progress,
      task.owner,
      task.updatedAt,
      (task.attachments || []).map((att) => att.id),
      (task.comments || []).map((comment) => [comment.id, (comment.attachments || []).map((att) => att.id)]),
      (task.logs || []).map((log) => log.id),
    ]),
    trash: (state?.trash || []).map((task) => [task.id, task.deletedAt, task.updatedAt]),
    attachmentTrash: (state?.attachmentTrash || []).map((att) => [att.id, att.deletedAt]),
    globalLogs: (state?.globalLogs || []).map((log) => log.id),
  });

const fuzzyScore = (task, query) => {
  const needle = normalizeSearch(query);
  if (!needle) return 1;

  const source = normalizeSearch(
    `${task.title} ${task.description} ${task.demand} ${task.owner} ${task.creator} ${task.status} ${task.priority}`,
  );
  if (!source) return 0;
  if (source.includes(needle)) return 100 + needle.length;

  let score = 0;
  let cursor = 0;
  for (const char of needle) {
    const index = source.indexOf(char, cursor);
    if (index >= 0) {
      score += index === cursor ? 8 : 4;
      cursor = index + 1;
    } else if (source.includes(char)) {
      score += 1;
    }
  }

  return score / Math.max(needle.length, 1);
};

const blankTask = (module, user) => ({
  title: "",
  module,
  description: "",
  demand: "",
  status: "待制作",
  progress: statusProgress("待制作"),
  priority: "P2",
  owner: user?.username || "",
  delivery: "",
});

const handleSpatialPointerMove = (event) => {
  const card = event.target.closest?.(
    ".spatial-card, .dashboard-hero, .module-header, .detail-head, .panel, .stat-card, .task-card, .module-card",
  );
  if (card) {
    const rect = card.getBoundingClientRect();
    card.style.setProperty("--mouse-x", `${event.clientX - rect.left}px`);
    card.style.setProperty("--mouse-y", `${event.clientY - rect.top}px`);
  }

  const magnetic = event.target.closest?.(".primary-btn, .ghost-btn, .icon-btn, .nav-item, .drag-handle");
  if (magnetic) {
    const rect = magnetic.getBoundingClientRect();
    const x = (event.clientX - (rect.left + rect.width / 2)) * 0.12;
    const y = (event.clientY - (rect.top + rect.height / 2)) * 0.12;
    magnetic.style.setProperty("--magnet-x", `${x}px`);
    magnetic.style.setProperty("--magnet-y", `${y}px`);
  }
};

const handleSpatialPointerOut = (event) => {
  const magnetic = event.target.closest?.(".primary-btn, .ghost-btn, .icon-btn, .nav-item, .drag-handle");
  if (magnetic && !magnetic.contains(event.relatedTarget)) {
    magnetic.style.setProperty("--magnet-x", "0px");
    magnetic.style.setProperty("--magnet-y", "0px");
  }
};

function App() {
  const cloudSyncEnabled = isCloudSyncEnabled();
  const [data, setData] = useState(() => loadState());
  const [currentUser, setCurrentUser] = useState(() => loadSession());
  const [syncState, setSyncState] = useState(() =>
    cloudSyncEnabled ? { status: "初始化中", detail: "准备连接云端..." } : { status: "本地模式", detail: "未配置云端同步" },
  );
  const [authMode, setAuthMode] = useState("login");
  const [authError, setAuthError] = useState("");
  const [activeView, setActiveView] = useState("dashboard");
  const [activeModule, setActiveModule] = useState("关务");
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [taskModal, setTaskModal] = useState(null);
  const [previewAttachmentItem, setPreviewAttachmentItem] = useState(null);
  const [draggedTaskId, setDraggedTaskId] = useState(null);
  const [draggedDashboardTaskId, setDraggedDashboardTaskId] = useState(null);
  const [trashQuery, setTrashQuery] = useState("");
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  const tutorialReturnRef = useRef(null);
  const lastRemoteUpdatedAtRef = useRef(null);
  const syncReadyRef = useRef(false);
  const persist = (next) => {
    const normalizedNext = normalizeState(next);
    setData(normalizedNext);
    saveState(normalizedNext);
    if (!cloudSyncEnabled || !syncReadyRef.current) return;
    void (async () => {
      try {
        const { state: remote, updatedAt: remoteRowAt } = await fetchCloudStateWithMeta();
        let toSave = normalizedNext;
        if (remote && hasCoreStateShape(remote) && !isEmptyCoreState(remote)) {
          const { state: merged, changed } = mergeCollaborativeState(normalizedNext, normalizeState(remote));
          toSave = normalizeState(merged);
          if (changed) {
            setData(toSave);
            saveState(toSave);
          }
        }
        const updatedAt = await saveCloudState(toSave);
        if (updatedAt) lastRemoteUpdatedAtRef.current = updatedAt;
        else if (remoteRowAt) lastRemoteUpdatedAtRef.current = remoteRowAt;
        setSyncState({
          status: "云端已同步",
          detail: `最后同步：${formatTime(updatedAt || remoteRowAt || new Date().toISOString())}`,
        });
      } catch (error) {
        setSyncState({
          status: "同步失败",
          detail: error?.message || "请检查 Supabase 配置",
        });
      }
    })();
  };

  const actor = currentUser?.username || "未知用户";
  const isAdmin = currentUser?.username === "Ares";
  const tutorialSteps = [
    {
      title: "首页仪表盘",
      desc: "先看首页入口，这里总览全部任务进度。",
      selector: '[data-tutorial="nav-dashboard"]',
      view: "dashboard",
    },
    {
      title: "进入业务模块",
      desc: "这里是关务入口，进入后可以看到筛选、拖动和排序。",
      selector: '[data-tutorial="nav-module-关务"]',
      view: "module",
      module: "关务",
    },
    {
      title: "任务详情操作位",
      desc: "这里是上传附件和留言区域。",
      selector: '[data-tutorial="detail-attachments"]',
      view: "detail",
    },
    {
      title: "任务时间线搜索",
      desc: "这里可以搜索时间线并查看日志详情。",
      selector: '[data-tutorial="timeline-search"]',
      view: "detail",
    },
  ];
  const startTutorial = ({ withConfirm = false } = {}) => {
    if (withConfirm) {
      const ok = confirm("确认进入教学引导？");
      if (!ok) return;
    }
    tutorialReturnRef.current = {
      activeView,
      activeModule,
      selectedTaskId,
    };
    setTutorialStep(0);
    setTutorialOpen(true);
  };

  const restoreTutorialView = () => {
    const saved = tutorialReturnRef.current;
    if (!saved) return;
    setActiveView(saved.activeView || "dashboard");
    setActiveModule(saved.activeModule || "关务");
    setSelectedTaskId(saved.selectedTaskId || null);
    tutorialReturnRef.current = null;
  };

  const completeTutorial = () => {
    if (!currentUser) {
      setTutorialOpen(false);
      return;
    }
    const users = data.users.map((u) => (u.id === currentUser.id ? { ...u, tutorialDone: true } : u));
    const nextUser = { ...currentUser, tutorialDone: true };
    persist({ ...data, users });
    setCurrentUser(nextUser);
    saveSession(nextUser);
    setTutorialOpen(false);
    setTutorialStep(0);
    restoreTutorialView();
  };

  const openTutorialFromDashboard = () => {
    startTutorial({ withConfirm: true });
  };
  const selectedTaskInTasks = data.tasks.find((task) => task.id === selectedTaskId);
  const selectedTaskInTrash = (data.trash || []).find((task) => task.id === selectedTaskId);
  const selectedTask = selectedTaskInTasks || selectedTaskInTrash;
  const selectedTaskLocation = selectedTaskInTasks ? "tasks" : selectedTaskInTrash ? "trash" : null;

  const buildTaskSnapshot = (task) => ({
    module: task.module,
    status: task.status,
    progress: task.progress,
    order: task.order,
    dashboardOrder: task.dashboardOrder,
    attachments: (task.attachments || []).map((att) => ({
      id: att.id,
      name: att.name,
      type: att.type,
      size: att.size,
      uploader: att.uploader,
      uploadedAt: att.uploadedAt,
      dataUrl: att.dataUrl || "",
    })),
  });

  const addLogToTask = (task, action, at = timestamp()) => {
    const snapshot = buildTaskSnapshot(task);
    const log = {
      id: makeId("log"),
      taskId: task.id,
      actor,
      action,
      time: at,
      snapshot,
    };
    return {
      task: {
        ...task,
        updatedAt: at,
        logs: [log, ...(task.logs || [])],
      },
      log,
    };
  };

  const updateTask = (taskId, patch, action) => {
    const at = timestamp();
    let globalLog = null;
    const tasks = data.tasks.map((task) => {
      if (task.id !== taskId) return task;
      const before = buildTaskSnapshot(task);
      const next = { ...task, ...patch };
      const after = buildTaskSnapshot(next);
      const changes = {
        status: before.status !== after.status ? { from: before.status, to: after.status } : null,
        progress: before.progress !== after.progress ? { from: before.progress, to: after.progress } : null,
        module: before.module !== after.module ? { from: before.module, to: after.module } : null,
        order: before.order !== after.order ? { from: before.order, to: after.order } : null,
        dashboardOrder: before.dashboardOrder !== after.dashboardOrder ? { from: before.dashboardOrder, to: after.dashboardOrder } : null,
      };

      const log = {
        id: makeId("log"),
        taskId: task.id,
        actor,
        action,
        time: at,
        snapshot: after,
        details: { before, after, changes },
      };
      globalLog = log;
      return { ...next, updatedAt: at, logs: [log, ...(task.logs || [])] };
    });
    persist({ ...data, tasks, globalLogs: globalLog ? [globalLog, ...data.globalLogs] : data.globalLogs });
  };

  const handleLogin = (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const username = String(form.get("username") || "").trim();
    const password = String(form.get("password") || "");
    const user = data.users.find((item) => item.username === username && item.password === password);

    if (!user) {
      setAuthError("用户名或密码不正确");
      return;
    }

    setAuthError("");
    setCurrentUser(user);
    saveSession(user);
  };

  const handleRegister = (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const username = String(form.get("username") || "").trim();
    const password = String(form.get("password") || "");
    const confirm = String(form.get("confirm") || "");

    if (!username || !password) {
      setAuthError("请填写公司英文名和密码");
      return;
    }

    if (password !== confirm) {
      setAuthError("两次输入的密码不一致");
      return;
    }

    if (data.users.some((item) => item.username.toLowerCase() === username.toLowerCase())) {
      setAuthError("这个公司英文名已经被注册");
      return;
    }

    const newUser = {
      id: makeId("user"),
      username,
      password,
      role: username === "Ares" ? "管理员" : "用户",
      tutorialDone: false,
    };
    const next = { ...data, users: [...data.users, newUser] };
    persist(next);
    setAuthError("");
    setCurrentUser(newUser);
    saveSession(newUser);
    startTutorial();
  };

  const logout = () => {
    clearSession();
    setCurrentUser(null);
    setAuthMode("login");
    setActiveView("dashboard");
    setSelectedTaskId(null);
  };

  const openModule = (module) => {
    setActiveModule(module);
    setActiveView("module");
    setSelectedTaskId(null);
  };

  const openTrash = () => {
    if (!isAdmin) {
      alert("只有管理员可以打开回收站。");
      setActiveView("dashboard");
      return;
    }
    setTrashQuery("");
    setActiveView("trash");
    setSelectedTaskId(null);
  };

  const openTask = (taskId) => {
    const task = data.tasks.find((item) => item.id === taskId) || (data.trash || []).find((item) => item.id === taskId);
    if (task?.module) setActiveModule(task.module);
    setSelectedTaskId(taskId);
    setActiveView("detail");
  };

  const saveTask = (formTask) => {
    const at = timestamp();
    if (formTask.id) {
      let globalLog = null;
      const tasks = data.tasks.map((task) => {
        if (task.id !== formTask.id) return task;
        const nextStatus = formTask.status || task.status;
        const { task: loggedTask, log } = addLogToTask(
          {
            ...task,
            ...formTask,
            description: formTask.description || formTask.demand?.slice(0, 80) || task.description,
            progress: statusProgress(nextStatus),
          },
          `${actor} 编辑了任务`,
          at,
        );
        globalLog = log;
        return loggedTask;
      });
      persist({ ...data, tasks, globalLogs: [globalLog, ...data.globalLogs] });
    } else {
      const moduleTasks = data.tasks.filter((task) => task.module === formTask.module);
      const newTask = {
        id: makeId("task"),
        ...formTask,
        description: formTask.description || String(formTask.demand || "").slice(0, 80),
        status: "待制作",
        progress: statusProgress("待制作"),
        priority: "P2",
        creator: actor,
        createdAt: at,
        updatedAt: at,
        order: moduleTasks.length + 1,
        dashboardOrder: data.tasks.length + 1,
        attachments: [],
        comments: [],
        logs: [],
      };
      const { task: loggedNewTask, log } = addLogToTask(newTask, `${actor} 新增了任务`, at);
      persist({ ...data, tasks: [...data.tasks, loggedNewTask], globalLogs: [log, ...data.globalLogs] });
      setActiveModule(newTask.module);
      setActiveView("module");
    }
    setTaskModal(null);
  };

  const deleteTask = (taskId) => {
    const task = data.tasks.find((item) => item.id === taskId);
    if (!task || !confirm(`确定删除「${task.title}」吗？`)) return;
    const at = timestamp();
    const deletedTask = { ...task, deletedAt: at };
    const { task: loggedDeleted, log } = addLogToTask(deletedTask, `${actor} 删除了任务「${task.title}」`, at);
    persist({
      ...data,
      tasks: data.tasks.filter((item) => item.id !== taskId),
      trash: [loggedDeleted, ...(data.trash || [])],
      globalLogs: [log, ...data.globalLogs],
    });
    if (selectedTaskId === taskId) {
      setSelectedTaskId(null);
      setActiveView("module");
    }
  };

  const restoreTask = (taskId) => {
    const trashItem = (data.trash || []).find((item) => item.id === taskId);
    if (!trashItem) return;
    const at = timestamp();
    const moduleMax = Math.max(
      0,
      ...data.tasks.filter((t) => t.module === trashItem.module).map((t) => Number(t.order || 0)),
    );
    const dashboardMax = Math.max(0, ...data.tasks.map((t) => Number(t.dashboardOrder || 0)));
    const restored = {
      ...trashItem,
      deletedAt: undefined,
      order: moduleMax + 1,
      dashboardOrder: dashboardMax + 1,
      updatedAt: at,
    };
    const { task: loggedRestored, log } = addLogToTask(restored, `${actor} 从回收站恢复了任务「${trashItem.title}」`, at);
    persist({
      ...data,
      tasks: [...data.tasks, loggedRestored],
      trash: (data.trash || []).filter((item) => item.id !== taskId),
      globalLogs: [log, ...data.globalLogs],
    });
  };

  const purgeTrashTask = (taskId) => {
    const trashItem = (data.trash || []).find((item) => item.id === taskId);
    if (!trashItem || !confirm(`确定彻底删除「${trashItem.title}」吗？这个操作无法恢复。`)) return;
    const at = timestamp();
    const log = {
      id: makeId("log"),
      taskId,
      actor,
      action: `${actor} 彻底删除了任务「${trashItem.title}」`,
      time: at,
      snapshot: {
        module: trashItem.module,
        status: trashItem.status,
        progress: trashItem.progress,
        order: trashItem.order,
        dashboardOrder: trashItem.dashboardOrder,
      },
    };
    persist({
      ...data,
      trash: (data.trash || []).filter((item) => item.id !== taskId),
      globalLogs: [log, ...data.globalLogs],
    });
  };

  const deleteTaskAttachment = (taskId, attachmentId) => {
    const task = data.tasks.find((item) => item.id === taskId);
    if (!task) return;
    const attachment = (task.attachments || []).find((att) => att.id === attachmentId);
    if (!attachment) return;
    if (!confirm(`确定删除附件「${attachment.name}」吗？`)) return;
    if (!confirm("再次确认：删除后将进入回收站，确定继续吗？")) return;
    const at = timestamp();
    const log = {
      id: makeId("log"),
      taskId,
      actor,
      action: `${actor} 删除了附件「${attachment.name}」（进入回收站）`,
      time: at,
      snapshot: buildTaskSnapshot(task),
    };
    const removed = {
      ...attachment,
      deletedAt: at,
      sourceType: "task",
      taskId,
      taskTitle: task.title,
    };
    const tasks = data.tasks.map((item) =>
      item.id === taskId
        ? {
            ...item,
            updatedAt: at,
            attachments: (item.attachments || []).filter((att) => att.id !== attachmentId),
            logs: [log, ...(item.logs || [])],
          }
        : item,
    );
    persist({
      ...data,
      tasks,
      attachmentTrash: [removed, ...(data.attachmentTrash || [])],
      globalLogs: [log, ...(data.globalLogs || [])],
    });
  };

  const deleteCommentAttachment = (taskId, commentId, attachmentId) => {
    const task = data.tasks.find((item) => item.id === taskId);
    if (!task) return;
    const comment = (task.comments || []).find((c) => c.id === commentId);
    const attachment = (comment?.attachments || []).find((att) => att.id === attachmentId);
    if (!attachment) return;
    if (!confirm(`确定删除留言附件「${attachment.name}」吗？`)) return;
    if (!confirm("再次确认：删除后将进入回收站，确定继续吗？")) return;
    const at = timestamp();
    const log = {
      id: makeId("log"),
      taskId,
      actor,
      action: `${actor} 删除了留言附件「${attachment.name}」（进入回收站）`,
      time: at,
      snapshot: buildTaskSnapshot(task),
    };
    const removed = {
      ...attachment,
      deletedAt: at,
      sourceType: "comment",
      taskId,
      taskTitle: task.title,
      commentId,
    };
    const tasks = data.tasks.map((item) =>
      item.id === taskId
        ? {
            ...item,
            updatedAt: at,
            comments: (item.comments || []).map((c) =>
              c.id === commentId
                ? { ...c, attachments: (c.attachments || []).filter((att) => att.id !== attachmentId) }
                : c,
            ),
            logs: [log, ...(item.logs || [])],
          }
        : item,
    );
    persist({
      ...data,
      tasks,
      attachmentTrash: [removed, ...(data.attachmentTrash || [])],
      globalLogs: [log, ...(data.globalLogs || [])],
    });
  };

  const restoreAttachment = (attachmentId) => {
    const item = (data.attachmentTrash || []).find((att) => att.id === attachmentId);
    if (!item) return;
    const at = timestamp();
    const tasks = data.tasks.map((task) => {
      if (task.id !== item.taskId) return task;
      const log = {
        id: makeId("log"),
        taskId: task.id,
        actor,
        action: `${actor} 从回收站恢复了附件「${item.name}」`,
        time: at,
        snapshot: buildTaskSnapshot(task),
      };
      if (item.sourceType === "comment") {
        return {
          ...task,
          comments: (task.comments || []).map((comment) =>
            comment.id === item.commentId
              ? {
                  ...comment,
                  attachments: [{ ...item, deletedAt: undefined, sourceType: undefined, taskTitle: undefined, commentId: undefined }, ...(comment.attachments || [])],
                }
              : comment,
          ),
          logs: [log, ...(task.logs || [])],
          updatedAt: at,
        };
      }
      return {
        ...task,
        attachments: [{ ...item, deletedAt: undefined, sourceType: undefined, taskTitle: undefined, commentId: undefined }, ...(task.attachments || [])],
        logs: [log, ...(task.logs || [])],
        updatedAt: at,
      };
    });
    persist({
      ...data,
      tasks,
      attachmentTrash: (data.attachmentTrash || []).filter((att) => att.id !== attachmentId),
      globalLogs: [
        {
          id: makeId("log"),
          taskId: item.taskId,
          actor,
          action: `${actor} 从回收站恢复了附件「${item.name}」`,
          time: at,
          snapshot: null,
        },
        ...(data.globalLogs || []),
      ],
    });
  };

  const purgeAttachmentTrash = (attachmentId) => {
    const item = (data.attachmentTrash || []).find((att) => att.id === attachmentId);
    if (!item || !confirm(`确定彻底删除附件「${item.name}」吗？这个操作无法恢复。`)) return;
    persist({
      ...data,
      attachmentTrash: (data.attachmentTrash || []).filter((att) => att.id !== attachmentId),
    });
  };

  const deleteLogEntry = (taskId, logId) => {
    const task = data.tasks.find((item) => item.id === taskId);
    if (!task) return;
    if (!confirm("确定删除这一条任务时间线记录吗？")) return;
    if (!confirm("再次确认：删除后无法恢复，确定继续吗？")) return;
    const tasks = data.tasks.map((item) =>
      item.id === taskId ? { ...item, logs: (item.logs || []).filter((log) => log.id !== logId) } : item,
    );
    persist({
      ...data,
      tasks,
      globalLogs: (data.globalLogs || []).filter((log) => log.id !== logId),
    });
  };

  const handleStatusChange = (task, status) => {
    const defaultProgress = statusProgress(status);
    updateTask(task.id, { status, progress: defaultProgress }, `${actor} 修改状态为 ${status}`);
  };

  const handleProgressChange = (task, progress) => {
    updateTask(task.id, { progress: Number(progress) }, `${actor} 修改进度为 ${progress}%`);
  };

  const moveTask = (taskId, direction) => {
    const moving = data.tasks.find((task) => task.id === taskId);
    if (!moving) return;
    const moduleTasks = data.tasks
      .filter((task) => task.module === moving.module)
      .sort((a, b) => a.order - b.order);
    const currentIndex = moduleTasks.findIndex((task) => task.id === taskId);
    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= moduleTasks.length) return;

    const reordered = [...moduleTasks];
    const [item] = reordered.splice(currentIndex, 1);
    reordered.splice(targetIndex, 0, item);
    const orderedIds = reordered.map((task) => task.id);
    const nextOrder = orderedIds.indexOf(taskId) + 1;
    const at = timestamp();
    const log = {
      id: makeId("log"),
      taskId,
      actor,
      action: "调整了任务制作顺序",
      time: at,
      snapshot: {
        module: moving.module,
        status: moving.status,
        progress: moving.progress,
        order: nextOrder,
        dashboardOrder: moving.dashboardOrder,
      },
    };

    const tasks = data.tasks.map((task) => {
      if (task.module !== moving.module) return task;
      const order = orderedIds.indexOf(task.id) + 1;
      if (task.id === taskId) {
        return { ...task, order, updatedAt: at, logs: [log, ...(task.logs || [])] };
      }
      return { ...task, order };
    });

    persist({ ...data, tasks, globalLogs: [log, ...data.globalLogs] });
  };

  const reorderTask = (targetId) => {
    if (!draggedTaskId || draggedTaskId === targetId) return;
    const dragged = data.tasks.find((task) => task.id === draggedTaskId);
    const target = data.tasks.find((task) => task.id === targetId);
    if (!dragged || !target || dragged.module !== target.module) return;

    const moduleTasks = data.tasks
      .filter((task) => task.module === dragged.module)
      .sort((a, b) => a.order - b.order);
    const remaining = moduleTasks.filter((task) => task.id !== draggedTaskId);
    const targetIndex = remaining.findIndex((task) => task.id === targetId);
    remaining.splice(targetIndex, 0, dragged);
    const orderedIds = remaining.map((task) => task.id);
    const nextOrder = orderedIds.indexOf(dragged.id) + 1;
    const at = timestamp();
    const log = {
      id: makeId("log"),
      taskId: dragged.id,
      actor,
      action: "拖动调整了任务制作顺序",
      time: at,
      snapshot: {
        module: dragged.module,
        status: dragged.status,
        progress: dragged.progress,
        order: nextOrder,
        dashboardOrder: dragged.dashboardOrder,
      },
    };

    const tasks = data.tasks.map((task) => {
      if (task.module !== dragged.module) return task;
      const order = orderedIds.indexOf(task.id) + 1;
      if (task.id === dragged.id) {
        return { ...task, order, updatedAt: at, logs: [log, ...(task.logs || [])] };
      }
      return { ...task, order };
    });

    persist({ ...data, tasks, globalLogs: [log, ...data.globalLogs] });
    setDraggedTaskId(null);
  };

  const moveDashboardTask = (taskId, direction) => {
    const orderedTasks = [...data.tasks].sort((a, b) => a.dashboardOrder - b.dashboardOrder);
    const currentIndex = orderedTasks.findIndex((task) => task.id === taskId);
    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= orderedTasks.length) return;

    const moving = orderedTasks[currentIndex];
    const reordered = [...orderedTasks];
    const [item] = reordered.splice(currentIndex, 1);
    reordered.splice(targetIndex, 0, item);
    const orderedIds = reordered.map((task) => task.id);
    const nextDashboardOrder = orderedIds.indexOf(taskId) + 1;
    const at = timestamp();
    const log = {
      id: makeId("log"),
      taskId,
      actor,
      action: "调整了仪表盘任务制作顺序",
      time: at,
      snapshot: {
        module: moving.module,
        status: moving.status,
        progress: moving.progress,
        order: moving.order,
        dashboardOrder: nextDashboardOrder,
      },
    };

    const tasks = data.tasks.map((task) => {
      const dashboardOrder = orderedIds.indexOf(task.id) + 1;
      if (task.id === taskId) {
        return { ...task, dashboardOrder, updatedAt: at, logs: [log, ...(task.logs || [])] };
      }
      return { ...task, dashboardOrder };
    });

    persist({ ...data, tasks, globalLogs: [log, ...data.globalLogs] });
  };

  const reorderDashboardTask = (targetId) => {
    if (!draggedDashboardTaskId || draggedDashboardTaskId === targetId) return;
    const orderedTasks = [...data.tasks].sort((a, b) => a.dashboardOrder - b.dashboardOrder);
    const dragged = orderedTasks.find((task) => task.id === draggedDashboardTaskId);
    if (!dragged) return;
    const remaining = orderedTasks.filter((task) => task.id !== draggedDashboardTaskId);
    const targetIndex = remaining.findIndex((task) => task.id === targetId);
    if (targetIndex < 0) return;
    remaining.splice(targetIndex, 0, dragged);
    const orderedIds = remaining.map((task) => task.id);
    const nextDashboardOrder = orderedIds.indexOf(dragged.id) + 1;
    const at = timestamp();
    const log = {
      id: makeId("log"),
      taskId: dragged.id,
      actor,
      action: "拖动调整了仪表盘任务制作顺序",
      time: at,
      snapshot: {
        module: dragged.module,
        status: dragged.status,
        progress: dragged.progress,
        order: dragged.order,
        dashboardOrder: nextDashboardOrder,
      },
    };

    const tasks = data.tasks.map((task) => {
      const dashboardOrder = orderedIds.indexOf(task.id) + 1;
      if (task.id === dragged.id) {
        return { ...task, dashboardOrder, updatedAt: at, logs: [log, ...(task.logs || [])] };
      }
      return { ...task, dashboardOrder };
    });

    persist({ ...data, tasks, globalLogs: [log, ...data.globalLogs] });
    setDraggedDashboardTaskId(null);
  };

  const addComment = async (taskId, content, files = []) => {
    const clean = content.trim();
    const pickedFiles = Array.from(files || []);
    if (!clean && !pickedFiles.length) return;
    const target = data.tasks.find((task) => task.id === taskId);
    const at = timestamp();
    const uploads = await Promise.all(
      pickedFiles.map(
        (file) =>
          new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () =>
              resolve({
                id: makeId("comment-att"),
                taskId,
                name: file.name,
                uploader: actor,
                uploadedAt: at,
                type: file.type || "application/octet-stream",
                size: file.size,
                dataUrl: file.size <= 8 * 1024 * 1024 ? reader.result : "",
              });
            reader.onerror = () =>
              resolve({
                id: makeId("comment-att"),
                taskId,
                name: file.name,
                uploader: actor,
                uploadedAt: at,
                type: file.type || "application/octet-stream",
                size: file.size,
                dataUrl: "",
              });
            if (file.size <= 8 * 1024 * 1024) reader.readAsDataURL(file);
            else reader.onload();
          }),
      ),
    );
    const comment = {
      id: makeId("comment"),
      taskId,
      author: actor,
      content: clean,
      time: at,
      attachments: uploads,
    };
    const log = {
      id: makeId("log"),
      taskId,
      actor,
      action: `${actor} 留言：${clean.slice(0, 24)}${clean.length > 24 ? "..." : ""}${uploads.length ? `（含${uploads.length}个附件）` : ""}`,
      time: at,
      snapshot: target
        ? {
            module: target.module,
            status: target.status,
            progress: target.progress,
            order: target.order,
            dashboardOrder: target.dashboardOrder,
          }
        : null,
    };
    const tasks = data.tasks.map((task) =>
      task.id === taskId
        ? {
            ...task,
            updatedAt: at,
            comments: [comment, ...(task.comments || [])],
            logs: [log, ...(task.logs || [])],
          }
        : task,
    );
    persist({ ...data, tasks, globalLogs: [log, ...data.globalLogs] });
  };

  const addAttachments = async (taskId, files) => {
    const selectedFiles = Array.from(files || []);
    if (!selectedFiles.length) return;

    const uploads = await Promise.all(
      selectedFiles.map(
        (file) =>
          new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () =>
              resolve({
                id: makeId("att"),
                taskId,
                name: file.name,
                uploader: actor,
                uploadedAt: timestamp(),
                type: file.type || "application/octet-stream",
                size: file.size,
                dataUrl: file.size <= 8 * 1024 * 1024 ? reader.result : "",
              });
            reader.onerror = () =>
              resolve({
                id: makeId("att"),
                taskId,
                name: file.name,
                uploader: actor,
                uploadedAt: timestamp(),
                type: file.type || "application/octet-stream",
                size: file.size,
                dataUrl: "",
              });
            if (file.size <= 8 * 1024 * 1024) reader.readAsDataURL(file);
            else reader.onload();
          }),
      ),
    );

    const target = data.tasks.find((task) => task.id === taskId);
    const at = timestamp();
    const log = {
      id: makeId("log"),
      taskId,
      actor,
      action: `${actor} 上传了 ${uploads.length} 个附件`,
      time: at,
      snapshot: target
        ? {
            module: target.module,
            status: target.status,
            progress: target.progress,
            order: target.order,
            dashboardOrder: target.dashboardOrder,
          }
        : null,
    };
    const tasks = data.tasks.map((task) =>
      task.id === taskId
        ? {
            ...task,
            updatedAt: at,
            attachments: [...uploads, ...(task.attachments || [])],
            logs: [log, ...(task.logs || [])],
          }
        : task,
    );
    persist({ ...data, tasks, globalLogs: [log, ...data.globalLogs] });
  };

  const downloadAttachment = (attachment) => {
    if (!attachment.dataUrl) {
      alert("这个附件没有可下载的本地内容；新上传且小于 8MB 的文件可以直接下载。");
      return;
    }
    const link = document.createElement("a");
    link.href = attachment.dataUrl;
    link.download = attachment.name;
    link.click();
  };

  const previewAttachment = (attachment) => {
    if (!attachment.dataUrl) {
      alert("这个附件没有可预览的本地内容；请重新上传文件后预览。");
      return;
    }
    setPreviewAttachmentItem(attachment);
  };

  const openAttachment = (attachment) => {
    if (!attachment.dataUrl) {
      alert("这个附件没有可打开的本地内容；请重新上传文件后打开。");
      return;
    }
    window.open(attachment.dataUrl, "_blank", "noopener,noreferrer");
  };

  useEffect(() => {
    if (!cloudSyncEnabled) return;
    let cancelled = false;
    let unsubscribeRealtime = () => {};
    let pollId = null;
    let removeVisibilityAndOnline = () => {};

    /** 把云端拉到的状态并入当前界面数据：远端主字段优先，本地补齐未同步的附件/留言/日志。 */
    const applyRemoteBundle = (remoteState, updatedAt, detailMsg) => {
      if (cancelled) return;
      if (!remoteState || !hasCoreStateShape(remoteState) || isEmptyCoreState(remoteState)) return;

      setData((prev) => {
        const normalizedRemote = normalizeState(remoteState);
        const beforeRevision = stateRevision(prev);
        const { state } = mergeCollaborativeState(normalizedRemote, prev);
        const merged = normalizeState(state);
        if (updatedAt) lastRemoteUpdatedAtRef.current = updatedAt;
        if (beforeRevision !== stateRevision(merged)) {
          saveState(merged);
          return merged;
        }
        return prev;
      });

      setSyncState({
        status: "云端已同步",
        detail: detailMsg,
      });
    };

    const pullRemoteAndMerge = async (detailMsg) => {
      if (cancelled || !syncReadyRef.current) return;
      try {
        const { state, updatedAt } = await fetchCloudStateWithMeta();
        if (cancelled) return;
        applyRemoteBundle(state, updatedAt, detailMsg);
      } catch (e) {
        console.warn("协作同步拉取失败:", e);
      }
    };

    const run = async () => {
      setSyncState({ status: "同步中", detail: "正在从云端加载数据..." });
      const fallbackState = buildInitialState();
      try {
        const meta = await fetchCloudStateWithMeta();
        if (cancelled) return;
        const remoteState = meta.state;
        const remoteAt = meta.updatedAt;
        if (hasCoreStateShape(remoteState) && !isEmptyCoreState(remoteState)) {
          const normalizedRemote = normalizeState(remoteState);
          setData(normalizedRemote);
          saveState(normalizedRemote);
          lastRemoteUpdatedAtRef.current = remoteAt;
          setSyncState({
            status: "云端已同步",
            detail: `最后同步：${formatTime(new Date().toISOString())}`,
          });
        } else if (isEmptyCoreState(remoteState)) {
          setData(fallbackState);
          saveState(fallbackState);
          const at = await saveCloudState(fallbackState);
          if (cancelled) return;
          lastRemoteUpdatedAtRef.current = at || lastRemoteUpdatedAtRef.current;
          setSyncState({
            status: "云端已初始化",
            detail: "已写入默认模块与任务数据",
          });
        } else if (remoteState) {
          setData(fallbackState);
          saveState(fallbackState);
          const at = await saveCloudState(fallbackState);
          if (cancelled) return;
          lastRemoteUpdatedAtRef.current = at || lastRemoteUpdatedAtRef.current;
          setSyncState({
            status: "云端已修复",
            detail: "检测到损坏数据，已自动覆盖为默认模块数据",
          });
        } else {
          const at = await saveCloudState(fallbackState);
          setData(fallbackState);
          saveState(fallbackState);
          if (cancelled) return;
          lastRemoteUpdatedAtRef.current = at || lastRemoteUpdatedAtRef.current;
          setSyncState({
            status: "云端已初始化",
            detail: "已上传当前本地数据",
          });
        }
      } catch (error) {
        if (cancelled) return;
        setSyncState({
          status: "同步失败",
          detail: error?.message || "请检查 Supabase 表结构和密钥",
        });
      } finally {
        if (!cancelled) syncReadyRef.current = true;
      }

      if (cancelled) return;

      unsubscribeRealtime = subscribeAppStateRemoteChanges(() => {
        void pullRemoteAndMerge(`实时协作 · ${formatTime(new Date().toISOString())}`);
      });

      pollId = window.setInterval(() => {
        void (async () => {
          if (cancelled) return;
          try {
            const at = await fetchCloudUpdatedAt();
            if (!at || at === lastRemoteUpdatedAtRef.current) return;
            await pullRemoteAndMerge(`定时同步 · ${formatTime(at)}`);
          } catch {
            /* 轮询失败不打扰用户 */
          }
        })();
      }, 8000);

      const onVisibility = () => {
        if (document.visibilityState === "visible") void pullRemoteAndMerge(`切回页面 · ${formatTime(new Date().toISOString())}`);
      };
      const onOnline = () => {
        void pullRemoteAndMerge(`网络恢复 · ${formatTime(new Date().toISOString())}`);
      };
      document.addEventListener("visibilitychange", onVisibility);
      window.addEventListener("online", onOnline);
      removeVisibilityAndOnline = () => {
        document.removeEventListener("visibilitychange", onVisibility);
        window.removeEventListener("online", onOnline);
      };
    };

    void run();
    return () => {
      cancelled = true;
      removeVisibilityAndOnline();
      unsubscribeRealtime();
      if (pollId != null) window.clearInterval(pollId);
    };
  }, []);

  useEffect(() => {
    if (currentUser && !currentUser.tutorialDone) {
      startTutorial();
    }
  }, [currentUser]);

  useEffect(() => {
    if (!tutorialOpen) return;
    const stepData = tutorialSteps[tutorialStep];
    if (!stepData) return;
    if (stepData.view === "dashboard") {
      setActiveView("dashboard");
      setSelectedTaskId(null);
    } else if (stepData.view === "module") {
      setActiveModule(stepData.module || "关务");
      setActiveView("module");
      setSelectedTaskId(null);
    } else if (stepData.view === "detail") {
      const sourceTask = data.tasks[0] || (data.trash || [])[0];
      if (sourceTask) {
        setSelectedTaskId(sourceTask.id);
        setActiveView("detail");
      }
    }
  }, [tutorialOpen, tutorialStep, data.tasks, data.trash]);

  if (!currentUser) {
    return (
      <AuthScreen
        mode={authMode}
        setMode={setAuthMode}
        error={authError}
        onLogin={handleLogin}
        onRegister={handleRegister}
      />
    );
  }

  return (
    <div className="app-shell" onPointerMove={handleSpatialPointerMove} onPointerOut={handleSpatialPointerOut}>
      <Sidebar
        activeView={activeView}
        activeModule={activeModule}
        openDashboard={() => setActiveView("dashboard")}
        openActivity={() => setActiveView("activity")}
        openModule={openModule}
        isAdmin={isAdmin}
        openTrash={openTrash}
        registeredUsers={data.users}
      />
      <main className="main-panel">
        <Header
          user={currentUser}
          isAdmin={isAdmin}
          onLogout={logout}
          syncState={syncState}
          registeredUsernames={isAdmin ? data.users.map((u) => u.username) : []}
        />
        {activeView === "dashboard" && (
          <Dashboard
            data={data}
            isAdmin={isAdmin}
            openModule={openModule}
            openTask={openTask}
            onOpenTutorial={openTutorialFromDashboard}
            moveDashboardTask={moveDashboardTask}
            reorderDashboardTask={reorderDashboardTask}
            draggedDashboardTaskId={draggedDashboardTaskId}
            setDraggedDashboardTaskId={setDraggedDashboardTaskId}
            openCreate={() => setTaskModal({ mode: "create", task: blankTask("关务", currentUser) })}
          />
        )}
        {activeView === "activity" && (
          <ActivityPage
            data={data}
            openTask={openTask}
            openAttachment={openAttachment}
            downloadAttachment={downloadAttachment}
            previewAttachment={previewAttachment}
          />
        )}
        {activeView === "trash" && (
          <TrashPage
            data={data}
            query={trashQuery}
            setQuery={setTrashQuery}
            openTask={openTask}
            restoreTask={restoreTask}
            purgeTrashTask={purgeTrashTask}
            restoreAttachment={restoreAttachment}
            purgeAttachmentTrash={purgeAttachmentTrash}
          />
        )}
        {activeView === "module" && (
          <ModulePage
            moduleName={activeModule}
            data={data}
            openTask={openTask}
            openCreate={() => setTaskModal({ mode: "create", task: blankTask(activeModule, currentUser) })}
            openEdit={(task) => setTaskModal({ mode: "edit", task })}
            deleteTask={deleteTask}
            onStatusChange={handleStatusChange}
            moveTask={moveTask}
            reorderTask={reorderTask}
            draggedTaskId={draggedTaskId}
            setDraggedTaskId={setDraggedTaskId}
          />
        )}
        {activeView === "detail" && selectedTask && (
          <TaskDetail
            task={selectedTask}
            back={() => setActiveView(selectedTaskLocation === "trash" ? "trash" : "module")}
            openEdit={(task) => setTaskModal({ mode: "edit", task })}
            deleteTask={deleteTask}
            onStatusChange={handleStatusChange}
            addComment={addComment}
            addAttachments={addAttachments}
            openAttachment={openAttachment}
            downloadAttachment={downloadAttachment}
            previewAttachment={previewAttachment}
            inTrash={selectedTaskLocation === "trash"}
            restoreTask={restoreTask}
            purgeTrashTask={purgeTrashTask}
            deleteLogEntry={deleteLogEntry}
            deleteTaskAttachment={deleteTaskAttachment}
            deleteCommentAttachment={deleteCommentAttachment}
          />
        )}
      </main>
      {taskModal && (
        <TaskModal
          modal={taskModal}
          users={data.users}
          isAdmin={isAdmin}
          onClose={() => setTaskModal(null)}
          onSave={saveTask}
        />
      )}
      {previewAttachmentItem && (
        <AttachmentPreviewModal
          attachment={previewAttachmentItem}
          onOpen={() => openAttachment(previewAttachmentItem)}
          onDownload={() => downloadAttachment(previewAttachmentItem)}
          onClose={() => setPreviewAttachmentItem(null)}
        />
      )}
      {tutorialOpen && (
        <TutorialModal
          step={tutorialStep}
          total={tutorialSteps.length}
          data={tutorialSteps[tutorialStep]}
          onPrev={() => setTutorialStep((s) => Math.max(0, s - 1))}
          onNext={() => {
            if (tutorialStep >= tutorialSteps.length - 1) completeTutorial();
            else setTutorialStep((s) => s + 1);
          }}
          onSkipStep={() => {
            if (tutorialStep >= tutorialSteps.length - 1) completeTutorial();
            else setTutorialStep((s) => s + 1);
          }}
          onSkipAll={completeTutorial}
        />
      )}
    </div>
  );
}

function AuthScreen({ mode, setMode, error, onLogin, onRegister }) {
  const isLogin = mode === "login";
  return (
    <div className="auth-screen" onPointerMove={handleSpatialPointerMove} onPointerOut={handleSpatialPointerOut}>
      <motion.section className="auth-card spatial-card" {...cinematicMotion}>
        <div className="brand-mark">兔</div>
        <h1>兔兔及时达自动化部署进度查询</h1>
        <p>内部自动化需求、SOP、留言和进度统一管理。</p>
        <form onSubmit={isLogin ? onLogin : onRegister} className="auth-form">
          <label>
            <span>{isLogin ? "用户名" : "公司英文名 / 用户名"}</span>
            <input name="username" placeholder={isLogin ? "请输入用户名" : "注册请使用公司英文名"} autoComplete="username" />
          </label>
          <label>
            <span>密码</span>
            <input name="password" type="password" placeholder="请输入密码" autoComplete={isLogin ? "current-password" : "new-password"} />
          </label>
          {!isLogin && (
            <label>
              <span>确认密码</span>
              <input name="confirm" type="password" placeholder="再次输入密码" autoComplete="new-password" />
            </label>
          )}
          {error && <div className="form-error">{error}</div>}
          <button className="primary-btn" type="submit">{isLogin ? "登录" : "注册并进入"}</button>
        </form>
        <div className="auth-switch">
          {isLogin ? "还没有账号？" : "已有账号？"}
          <button type="button" onClick={() => setMode(isLogin ? "register" : "login")}>
            {isLogin ? "注册" : "返回登录"}
          </button>
        </div>
      </motion.section>
    </div>
  );
}

function Sidebar({ activeView, activeModule, openDashboard, openActivity, openModule, isAdmin, openTrash, registeredUsers = [] }) {
  const sortedUsers = useMemo(
    () => [...registeredUsers].sort((a, b) => String(a.username).localeCompare(String(b.username), "zh-Hans-CN")),
    [registeredUsers],
  );

  return (
    <aside className="sidebar">
      <div className="sidebar-title">
        <span>兔</span>
        <strong className="brand-lock">兔兔及时达自动化部署</strong>
      </div>
      <button
        className={`nav-item ${activeView === "dashboard" ? "active" : ""}`}
        onClick={openDashboard}
        data-tutorial="nav-dashboard"
      >
        <LayoutDashboard size={18} /> 首页仪表盘
      </button>
      <button
        className={`nav-item ${activeView === "activity" ? "active" : ""}`}
        onClick={openActivity}
        data-tutorial="nav-activity"
      >
        <Activity size={18} /> 全站动态
      </button>
      <div className="nav-section">业务模块</div>
      {MODULES.map((module) => (
        <button
          key={module.key}
          className={`nav-item ${["module", "detail"].includes(activeView) && activeModule === module.key ? "active" : ""}`}
          onClick={() => openModule(module.key)}
          data-tutorial={`nav-module-${module.key}`}
        >
          <span className={`module-dot ${module.tone}`} />
          {module.label}
        </button>
      ))}
      {isAdmin && (
        <>
          <div className="nav-section">管理员</div>
          <button
            className={`nav-item ${activeView === "trash" ? "active" : ""}`}
            onClick={openTrash}
            data-tutorial="nav-trash"
          >
            <Trash2 size={18} /> 回收站
          </button>
          <div className="sidebar-registered-block" data-tutorial="admin-registered-users">
            <div className="sidebar-registered-head">
              <Users size={14} aria-hidden />
              已注册用户
              <span className="sidebar-registered-count">{registeredUsers.length}</span>
            </div>
            <ul className="sidebar-registered-list">
              {sortedUsers.map((u) => (
                <li key={u.id} title={u.role || ""}>
                  <span className="sidebar-registered-name">{u.username}</span>
                  {u.role === "管理员" && <span className="sidebar-registered-badge">管理员</span>}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </aside>
  );
}

function Header({ user, isAdmin, onLogout, syncState, registeredUsernames = [] }) {
  const rosterTitle =
    isAdmin && registeredUsernames.length > 0 ? `已注册：${registeredUsernames.join("、")}` : "";

  return (
    <header className="topbar">
      <div>
        <p className="eyebrow">Automation Deployment</p>
        <h2>兔兔及时达自动化部署进度查询系统</h2>
      </div>
      <div className="user-block">
        <div className="user-pill" title={syncState.detail}>
          <Activity size={17} />
          <span>{syncState.status}</span>
          <small>{syncState.detail}</small>
        </div>
        {isAdmin && registeredUsernames.length > 0 && (
          <div className="user-pill admin-roster-pill" title={rosterTitle}>
            <Users size={17} />
            <span>已注册 {registeredUsernames.length} 个账号</span>
            <small>
              {registeredUsernames.length <= 4
                ? registeredUsernames.join("、")
                : `${registeredUsernames.slice(0, 4).join("、")}…`}
            </small>
          </div>
        )}
        <div className="user-pill">
          {isAdmin ? <ShieldCheck size={17} /> : <UserRound size={17} />}
          <span>{user.username}</span>
          <small>{user.role}</small>
        </div>
        <button className="icon-btn" onClick={onLogout} title="退出登录">
          <LogOut size={18} />
        </button>
      </div>
    </header>
  );
}

function ActivityPage({ data, openTask, openAttachment, downloadAttachment, previewAttachment }) {
  const [query, setQuery] = useState("");
  const taskById = useMemo(() => {
    const map = new Map();
    [...(data.tasks || []), ...(data.trash || [])].forEach((task) => map.set(task.id, task));
    return map;
  }, [data.tasks, data.trash]);

  const logs = useMemo(() => {
    const byId = new Map();
    (data.globalLogs || []).forEach((log) => log?.id && byId.set(log.id, log));
    [...(data.tasks || []), ...(data.trash || [])].forEach((task) =>
      (task.logs || []).forEach((log) => log?.id && byId.set(log.id, log)),
    );
    const needle = normalizeSearch(query);
    return [...byId.values()]
      .map((log) => {
        const task = taskById.get(log.taskId);
        return {
          ...log,
          taskTitle: task?.title || "未知任务",
          taskModule: task?.module || log.snapshot?.module || "-",
          inTrash: Boolean(task?.deletedAt),
        };
      })
      .filter((log) => {
        if (!needle) return true;
        return normalizeSearch(`${log.actor} ${log.action} ${log.taskTitle} ${log.taskModule}`).includes(needle);
      })
      .sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));
  }, [data.globalLogs, data.tasks, data.trash, query, taskById]);

  const attachments = useMemo(() => {
    const items = [];
    for (const task of data.tasks || []) {
      (task.attachments || []).forEach((attachment) =>
        items.push({ ...attachment, taskTitle: task.title, taskModule: task.module, sourceLabel: "任务附件" }),
      );
      (task.comments || []).forEach((comment) =>
        (comment.attachments || []).forEach((attachment) =>
          items.push({
            ...attachment,
            taskTitle: task.title,
            taskModule: task.module,
            sourceLabel: `留言附件 · ${comment.author || "未知用户"}`,
          }),
        ),
      );
    }
    const needle = normalizeSearch(query);
    return items
      .filter((item) => {
        if (!needle) return true;
        return normalizeSearch(`${item.name} ${item.uploader} ${item.taskTitle} ${item.taskModule} ${item.sourceLabel}`).includes(needle);
      })
      .sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0));
  }, [data.tasks, query]);

  return (
    <motion.div className="page-stack" {...cinematicMotion}>
      <section className="module-header">
        <div>
          <p className="eyebrow">Team Activity</p>
          <h1>全站动态</h1>
          <p>所有账号的上传、留言、状态调整、删除和恢复都会汇总在这里，方便每个人确认发生了什么。</p>
        </div>
      </section>

      <section className="filter-bar activity-filter">
        <label className="search-box">
          <Search size={17} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索操作人、任务、动作或附件" />
        </label>
      </section>

      <section className="split-grid activity-grid">
        <div className="panel timeline-panel">
          <div className="panel-title"><Activity size={18} /><h3>所有操作记录</h3></div>
          <OverlayScrollbarsComponent className="timeline timeline-scrollable" options={TIMELINE_SCROLLBAR_OPTIONS} defer>
            {logs.map((log) => (
              <button key={log.id} type="button" className="timeline-item clickable" onClick={() => openTask(log.taskId)}>
                <div className="timeline-item-head">
                  <strong>{isOrderAdjustAction(log.action) ? "顺序调整" : log.actor}</strong>
                  <small>{formatTime(log.time)}</small>
                </div>
                <p>{log.action}</p>
                <small>
                  {log.taskModule} · {log.taskTitle}
                  {log.inTrash ? " · 回收站" : ""}
                  {log.snapshot ? ` · 状态：${log.snapshot.status || "-"}` : ""}
                </small>
              </button>
            ))}
            {!logs.length && <p className="muted">暂无匹配的操作记录</p>}
          </OverlayScrollbarsComponent>
        </div>

        <div className="panel timeline-panel">
          <div className="panel-title"><Paperclip size={18} /><h3>全站附件</h3></div>
          <OverlayScrollbarsComponent className="attachment-list activity-attachment-list" options={TIMELINE_SCROLLBAR_OPTIONS} defer>
            {attachments.map((attachment) => (
              <div key={attachment.id} className="attachment-item activity-attachment-item">
                <FilePlus2 size={17} />
                <span>
                  <strong>{attachment.name}</strong>
                  <small>
                    {attachment.uploader || "未知用户"} · {attachment.taskModule} · {attachment.taskTitle} · {attachment.sourceLabel} · {formatTime(attachment.uploadedAt)}
                  </small>
                </span>
                <button className="icon-btn" onClick={() => previewAttachment(attachment)} title="预览"><Eye size={15} /></button>
                <button className="icon-btn" onClick={() => openAttachment(attachment)} title="打开"><ExternalLink size={15} /></button>
                <button className="icon-btn" onClick={() => downloadAttachment(attachment)} title="下载"><Download size={15} /></button>
                <button className="ghost-btn detail-open-btn" type="button" onClick={() => openTask(attachment.taskId)}>任务</button>
              </div>
            ))}
            {!attachments.length && <p className="muted">暂无匹配的附件</p>}
          </OverlayScrollbarsComponent>
        </div>
      </section>
    </motion.div>
  );
}

function Dashboard({
  data,
  isAdmin,
  openModule,
  openTask,
  openCreate,
  onOpenTutorial,
  moveDashboardTask,
  reorderDashboardTask,
  draggedDashboardTaskId,
  setDraggedDashboardTaskId,
}) {
  const stats = useMemo(() => {
    const total = data.tasks.length;
    const done = data.tasks.filter((task) => task.status === "已完成").length;
    const avg = total ? Math.round(data.tasks.reduce((sum, task) => sum + Number(task.progress || 0), 0) / total) : 0;
    return {
      total,
      done,
      avg,
      waiting: data.tasks.filter((task) => task.status === "待制作").length,
      doing: data.tasks.filter((task) => task.status === "制作中").length,
      change: data.tasks.filter((task) => task.status === "待修改").length,
    };
  }, [data.tasks]);

  const recentTasks = data.tasks
    .map((task) => {
      const recentLog = [...(task.logs || [])].sort((a, b) => new Date(b.time) - new Date(a.time)).find(trackedRecentLog);
      if (!recentLog) return null;
      return {
        ...task,
        recentLogTime: recentLog.time,
        recentUpdateSummary: buildRecentUpdateSummary(recentLog),
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.recentLogTime) - new Date(a.recentLogTime))
    .slice(0, 5);
  const orderedTasks = [...data.tasks]
    .filter((task) => task.status !== "已完成")
    .sort((a, b) => a.dashboardOrder - b.dashboardOrder);

  return (
    <motion.div className="page-stack" {...cinematicMotion}>
      <section className="dashboard-hero">
        <div>
          <p className="eyebrow">{isAdmin ? "Ares 全局管理视图" : "团队任务视图"}</p>
          <h1>自动化需求进度一屏掌握</h1>
          <p>查看四大模块、关键状态、任务制作顺序和最近操作，所有动作都会留下记录。</p>
        </div>
        <div className="dashboard-hero-actions">
          <button className="ghost-btn" type="button" onClick={onOpenTutorial}>教学引导</button>
          <button className="primary-btn" onClick={openCreate}>
            <Plus size={18} /> 新增任务
          </button>
        </div>
      </section>

      <section className="stat-grid">
        <StatCard icon={<Files />} label="总任务数量" value={stats.total} />
        <StatCard icon={<Clock3 />} label="待制作" value={stats.waiting} />
        <StatCard icon={<Gauge />} label="制作中" value={stats.doing} />
        <StatCard icon={<CheckCircle2 />} label="已完成" value={stats.done} />
        <StatCard icon={<Activity />} label="待修改" value={stats.change} />
        <StatCard icon={<BarChart3 />} label="整体完成率" value={`${stats.avg}%`} />
      </section>

      <section className="module-grid">
        {MODULES.map((module) => {
          const moduleTasks = data.tasks.filter((task) => task.module === module.key);
          const completed = moduleTasks.filter((task) => task.status === "已完成").length;
          return (
            <button key={module.key} className={`module-card ${module.tone}`} onClick={() => openModule(module.key)}>
              <div>
                <span className={`module-dot ${module.tone}`} />
                <h3>{module.label}</h3>
              </div>
              <strong>{moduleTasks.length}</strong>
              <small>{completed} 个已完成</small>
            </button>
          );
        })}
      </section>

      <section className="split-grid">
        <ListPanel title="最近更新任务" icon={<Clock3 size={18} />} tasks={recentTasks} openTask={openTask} />
        <ListPanel
          title="任务制作顺序"
          icon={<ArrowUpDown size={18} />}
          tasks={orderedTasks}
          openTask={openTask}
          showOrder
          scrollable
          moveTask={moveDashboardTask}
          reorderTask={reorderDashboardTask}
          draggedTaskId={draggedDashboardTaskId}
          setDraggedTaskId={setDraggedDashboardTaskId}
          orderField="dashboardOrder"
        />
      </section>

      {isAdmin && <AdminUsersPanel users={data.users} />}
    </motion.div>
  );
}

function StatCard({ icon, label, value }) {
  return (
    <div className="stat-card">
      <span>{icon}</span>
      <p>{label}</p>
      <strong>{value}</strong>
    </div>
  );
}

function ListPanel({
  title,
  icon,
  tasks,
  openTask,
  showOrder = false,
  moveTask,
  reorderTask,
  draggedTaskId,
  setDraggedTaskId,
  orderField = "order",
  scrollable = false,
}) {
  const listContent = (
    <>
      {tasks.map((task) => (
        <div
          key={task.id}
          className={`compact-item ${draggedTaskId === task.id ? "dragging" : ""}`}
          draggable={showOrder}
          onDragStart={() => showOrder && setDraggedTaskId?.(task.id)}
          onDragEnd={() => showOrder && setDraggedTaskId?.(null)}
          onDragOver={(event) => showOrder && event.preventDefault()}
          onDrop={() => showOrder && reorderTask?.(task.id)}
        >
          <button className="compact-open-btn" onClick={() => openTask(task.id)}>
            <span>
              <strong>{task.title}</strong>
              <small>
                {showOrder
                  ? `${task.module} · 第 ${task[orderField]} 位 · ${task.status}`
                  : `${task.module} · ${task.owner} · ${formatTime(task.recentLogTime || task.updatedAt)}`}
              </small>
              {!showOrder && task.recentUpdateSummary && <small className="compact-update-note">{task.recentUpdateSummary}</small>}
            </span>
          </button>
          {showOrder && (
            <div className="compact-row-controls" onClick={(event) => event.stopPropagation()}>
              <button className="icon-btn" type="button" onClick={() => moveTask?.(task.id, "up")} title="上移" disabled={task[orderField] === 1}>
                <ChevronUp size={16} />
              </button>
              <button className="icon-btn" type="button" onClick={() => moveTask?.(task.id, "down")} title="下移" disabled={task[orderField] === tasks.length}>
                <ChevronDown size={16} />
              </button>
            </div>
          )}
        </div>
      ))}
    </>
  );

  return (
    <div className="panel">
      <div className="panel-title">{icon}<h3>{title}</h3></div>
      {scrollable ? (
        <OverlayScrollbarsComponent className="compact-list scrollable" options={SCROLLBAR_OPTIONS} defer>
          {listContent}
        </OverlayScrollbarsComponent>
      ) : (
        <div className="compact-list">{listContent}</div>
      )}
    </div>
  );
}

function AdminUsersPanel({ users }) {
  return (
    <div className="panel admin-users-panel">
      <div className="panel-title">
        <ShieldCheck size={18} />
        <h3>已注册用户（{users.length}）</h3>
      </div>
      <div className="user-matrix">
        {users.map((user) => (
          <div key={user.id} className="user-row">
            <span className="user-orb">{user.username.slice(0, 1)}</span>
            <span>
              <strong>{user.username}</strong>
              <small>{user.role}</small>
            </span>
            <i>Active</i>
          </div>
        ))}
      </div>
    </div>
  );
}

function ModulePage({
  moduleName,
  data,
  openTask,
  openCreate,
  openEdit,
  deleteTask,
  onStatusChange,
  moveTask,
  reorderTask,
  draggedTaskId,
  setDraggedTaskId,
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("全部");
  const [owner, setOwner] = useState("全部");

  const owners = [...new Set(data.tasks.map((task) => task.owner).filter(Boolean))];
  const scoredTasks = data.tasks
    .filter((task) => task.module === moduleName)
    .filter((task) => status === "全部" || task.status === status)
    .filter((task) => owner === "全部" || task.owner === owner)
    .map((task) => ({ task, score: fuzzyScore(task, query) }))
    .filter((item) => !query.trim() || item.score >= 2)
    .sort((a, b) => (query.trim() ? b.score - a.score : a.task.order - b.task.order));

  return (
    <motion.div className="page-stack" {...cinematicMotion}>
      <section className="module-header">
        <div>
          <p className="eyebrow">Module</p>
          <h1>{moduleName}自动化任务</h1>
          <p>拖动滑块或点击上下按钮即可调整当前模块的任务制作顺序。</p>
        </div>
        <button className="primary-btn" onClick={openCreate}>
          <Plus size={18} /> 新增任务
        </button>
      </section>

      <section className="filter-bar">
        <label className="search-box">
          <Search size={17} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索任务、说明、负责人、创建人" />
        </label>
        <SelectWithIcon icon={<Filter size={16} />} value={status} onChange={setStatus} options={["全部", ...Object.keys(STATUSES)]} />
        <SelectWithIcon icon={<UserRound size={16} />} value={owner} onChange={setOwner} options={["全部", ...owners]} />
      </section>

      <section className="task-grid">
        {scoredTasks.map(({ task, score }) => (
          <TaskCard
            key={task.id}
            task={task}
            matchScore={query.trim() ? score : null}
            openTask={openTask}
            openEdit={openEdit}
            deleteTask={deleteTask}
            onStatusChange={onStatusChange}
            moveTask={moveTask}
            reorderTask={reorderTask}
            draggedTaskId={draggedTaskId}
            setDraggedTaskId={setDraggedTaskId}
            isFirst={task.order === 1}
            isLast={task.order === data.tasks.filter((item) => item.module === moduleName).length}
          />
        ))}
        {!scoredTasks.length && (
          <div className="empty-state">
            <Files size={28} />
            <strong>没有找到任务</strong>
            <p>调整筛选条件，或新建一个自动化需求。</p>
          </div>
        )}
      </section>
    </motion.div>
  );
}

function SelectWithIcon({ icon, value, onChange, options }) {
  return (
    <label className="select-box">
      {icon}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => {
          const normalized = typeof option === "string" ? { value: option, label: option } : option;
          return <option key={normalized.value} value={normalized.value}>{normalized.label}</option>;
        })}
      </select>
    </label>
  );
}

function TaskCard({
  task,
  matchScore,
  openTask,
  openEdit,
  deleteTask,
  onStatusChange,
  moveTask,
  reorderTask,
  draggedTaskId,
  setDraggedTaskId,
  isFirst,
  isLast,
}) {
  return (
    <motion.article
      className={`task-card ${draggedTaskId === task.id ? "dragging" : ""}`}
      initial={{ opacity: 0, y: 18, filter: "blur(8px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ type: "spring", bounce: 0, duration: 0.55 }}
      draggable
      onDragStart={() => setDraggedTaskId(task.id)}
      onDragEnd={() => setDraggedTaskId(null)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={() => reorderTask(task.id)}
      onClick={() => openTask(task.id)}
    >
      <div className="task-card-top">
        <button className="task-title-btn" onClick={(event) => { event.stopPropagation(); openTask(task.id); }}>{task.title}</button>
        <div className="order-controls" onClick={(event) => event.stopPropagation()}>
          <button className="icon-btn drag-handle" type="button" title="拖动调整顺序">
            <GripVertical size={16} />
          </button>
          <button className="icon-btn" type="button" onClick={() => moveTask(task.id, "up")} title="上移" disabled={isFirst}>
            <ChevronUp size={16} />
          </button>
          <button className="icon-btn" type="button" onClick={() => moveTask(task.id, "down")} title="下移" disabled={isLast}>
            <ChevronDown size={16} />
          </button>
        </div>
      </div>
      {matchScore !== null && <span className="match-pill">匹配度 {Math.min(100, Math.round(matchScore))}</span>}
      <p>{buildLatestSituation(task)}</p>
      <div className="meta-row">
        <span className={statusClass(task.status)}>{task.status}</span>
        <span>负责人：{task.owner}</span>
        <span>创建：{task.creator}</span>
      </div>
      <ProgressBar value={task.progress} />
      <div className="card-counts">
        <span><MessageSquareText size={15} />{task.comments?.length || 0}</span>
        <span><Paperclip size={15} />{task.attachments?.length || 0}</span>
        <span>{formatTime(task.updatedAt)}</span>
      </div>
      <div className="card-controls" onClick={(event) => event.stopPropagation()}>
        <select value={task.status} onChange={(event) => onStatusChange(task, event.target.value)}>
          {Object.keys(STATUSES).map((item) => <option key={item}>{item}</option>)}
        </select>
        <button className="ghost-btn detail-open-btn" onClick={() => openTask(task.id)} title="查看详情">
          <Eye size={16} /> 详情
        </button>
        <button className="icon-btn" onClick={() => openEdit(task)} title="编辑">
          <Edit3 size={16} />
        </button>
        <button className="icon-btn danger" onClick={() => deleteTask(task.id)} title="删除">
          <Trash2 size={16} />
        </button>
      </div>
    </motion.article>
  );
}

function ProgressBar({ value }) {
  return (
    <div className="progress-wrap" aria-label={`当前进度 ${value}%`}>
      <div className="progress-line">
        <span style={{ width: `${Math.max(0, Math.min(100, Number(value) || 0))}%` }} />
      </div>
    </div>
  );
}

function TaskDetail({
  task,
  back,
  openEdit,
  deleteTask,
  onStatusChange,
  addComment,
  addAttachments,
  openAttachment,
  downloadAttachment,
  previewAttachment,
  inTrash = false,
  restoreTask,
  purgeTrashTask,
  deleteLogEntry,
  deleteTaskAttachment,
  deleteCommentAttachment,
}) {
  const [comment, setComment] = useState("");
  const [commentFiles, setCommentFiles] = useState([]);
  const [pendingTaskFiles, setPendingTaskFiles] = useState([]);
  const [taskUploadBusy, setTaskUploadBusy] = useState(false);
  const [commentSubmitBusy, setCommentSubmitBusy] = useState(false);
  const taskFileInputRef = useRef(null);
  const [selectedLog, setSelectedLog] = useState(null);
  const [timelineQuery, setTimelineQuery] = useState("");
  const [timelineVisibleCount, setTimelineVisibleCount] = useState(120);

  useEffect(() => {
    setPendingTaskFiles([]);
    setComment("");
    setCommentFiles([]);
    if (taskFileInputRef.current) taskFileInputRef.current.value = "";
  }, [task.id]);

  const submitComment = async (event) => {
    event.preventDefault();
    const clean = comment.trim();
    if (!clean && !commentFiles.length) return;
    if (commentSubmitBusy) return;
    setCommentSubmitBusy(true);
    try {
      await addComment(task.id, comment, commentFiles);
      setComment("");
      setCommentFiles([]);
    } finally {
      setCommentSubmitBusy(false);
    }
  };

  const addCommentDraftFiles = (incoming) => {
    const next = Array.from(incoming || []);
    if (!next.length) return;
    setCommentFiles((current) => [...current, ...next]);
  };

  const removeCommentDraftFile = (index) => {
    setCommentFiles((current) => current.filter((_, i) => i !== index));
  };

  const addPendingTaskFiles = (incoming) => {
    const next = Array.from(incoming || []);
    if (!next.length) return;
    setPendingTaskFiles((current) => [...current, ...next]);
    if (taskFileInputRef.current) taskFileInputRef.current.value = "";
  };

  const removePendingTaskFile = (index) => {
    setPendingTaskFiles((current) => current.filter((_, i) => i !== index));
  };

  const submitTaskAttachments = async () => {
    if (!pendingTaskFiles.length || taskUploadBusy) return;
    setTaskUploadBusy(true);
    try {
      await addAttachments(task.id, pendingTaskFiles);
      setPendingTaskFiles([]);
      if (taskFileInputRef.current) taskFileInputRef.current.value = "";
    } finally {
      setTaskUploadBusy(false);
    }
  };

  const timelineLogs = useMemo(() => {
    const source = [...(task.logs || [])].sort((a, b) => new Date(b.time) - new Date(a.time));
    const needle = normalizeSearch(timelineQuery);
    return source.filter((item) => {
      if (!needle) return true;
      const hay = normalizeSearch(
        `${item.actor || ""} ${item.action || ""} ${item.snapshot?.status || ""} ${item.snapshot?.module || ""} ${item.snapshot?.progress ?? ""}`,
      );
      return hay.includes(needle);
    });
  }, [task.logs, timelineQuery]);

  useEffect(() => {
    setTimelineVisibleCount(120);
  }, [task.id, timelineQuery]);

  const visibleTimelineLogs = useMemo(
    () => timelineLogs.slice(0, timelineVisibleCount),
    [timelineLogs, timelineVisibleCount],
  );
  const hasMoreTimelineLogs = visibleTimelineLogs.length < timelineLogs.length;

  return (
    <motion.div className="detail-page" {...cinematicMotion}>
      <button className="text-btn" onClick={back}><ChevronLeft size={17} /> 返回模块</button>
      <section className="detail-head">
        <div>
          <div className="meta-row">
            <span className={statusClass(task.status)}>{task.status}</span>
            <span>{task.module}</span>
            {inTrash && <span className="status status-gray">回收站</span>}
          </div>
          <h1>{task.title}</h1>
          <p>{task.description}</p>
        </div>
        <div className="detail-actions">
          {!inTrash && <button className="ghost-btn" onClick={() => openEdit(task)}><Edit3 size={17} /> 编辑</button>}
          {!inTrash && <button className="ghost-btn danger" onClick={() => deleteTask(task.id)}><Trash2 size={17} /> 删除</button>}
          {inTrash && (
            <>
              <button className="ghost-btn" onClick={() => restoreTask?.(task.id)}><Save size={17} /> 恢复</button>
              <button className="ghost-btn danger" onClick={() => purgeTrashTask?.(task.id)}><Trash2 size={17} /> 彻底删除</button>
            </>
          )}
        </div>
      </section>

      <section className="detail-grid">
        <div className="panel detail-main">
          <div className="section-title"><h3>基础信息</h3></div>
          <div className="info-grid">
            <Info label="所属模块" value={task.module} />
            <Info label="创建人" value={task.creator} />
            <Info label="负责人" value={task.owner} />
            <Info label="交付形式" value={task.delivery || "管理员待填写"} />
            <Info label="创建时间" value={formatTime(task.createdAt)} />
            <Info label="更新时间" value={formatTime(task.updatedAt)} />
          </div>
          <div className="inline-controls">
            <label>
              <span>状态</span>
              <select disabled={inTrash} value={task.status} onChange={(event) => onStatusChange(task, event.target.value)}>
                {Object.keys(STATUSES).map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
          </div>
          <ProgressBar value={task.progress} />

          <div className="section-title"><h3>需求说明</h3></div>
          <div className="description-box">{task.demand}</div>
        </div>

        <aside className="panel side-panel" data-tutorial="detail-attachments">
          <div className="section-title"><h3>SOP 和附件</h3></div>
          {!inTrash && (
            <>
              <p className="muted upload-flow-hint">
                本栏附件会出现在<strong>下方列表</strong>；若在「留言区」选文件，附件会挂在<strong>对应留言下方</strong>。选文件后务必点<strong>提交上传</strong>才会同步给他人。
              </p>
              <label className="upload-zone">
                <Upload size={20} />
                <span>选择文件（可多选）</span>
                <small>PDF、Word、Excel、图片、TXT、CSV、ZIP、视频；选好后点下方「提交上传」</small>
                <input ref={taskFileInputRef} type="file" multiple onChange={(event) => addPendingTaskFiles(event.target.files)} />
              </label>
              {!!pendingTaskFiles.length && (
                <div className="comment-draft-files task-pending-files">
                  {pendingTaskFiles.map((file, index) => (
                    <div key={`${file.name}-${index}-${file.size}`} className="comment-draft-file">
                      <span>
                        <strong>{file.name}</strong>
                        <small>{Math.max(1, Math.round((file.size || 0) / 1024))} KB</small>
                      </span>
                      <button type="button" className="icon-btn danger" onClick={() => removePendingTaskFile(index)} title="移除">
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="task-attachment-submit-row">
                <button
                  type="button"
                  className="primary-btn"
                  disabled={!pendingTaskFiles.length || taskUploadBusy}
                  onClick={() => void submitTaskAttachments()}
                >
                  <Upload size={17} /> {taskUploadBusy ? "提交中…" : "提交上传"}
                </button>
                {!!pendingTaskFiles.length && !taskUploadBusy && (
                  <small className="muted">待上传 {pendingTaskFiles.length} 个文件</small>
                )}
              </div>
            </>
          )}
          {inTrash && <p className="muted">回收站任务不支持上传附件。</p>}
          <div className="attachment-list">
            {(task.attachments || []).map((attachment) => (
              <div key={attachment.id} className="attachment-item">
                <FilePlus2 size={17} />
                <span>
                  <strong>{attachment.name}</strong>
                  <small>{attachment.uploader} · {formatTime(attachment.uploadedAt)}</small>
                </span>
                <button className="icon-btn" onClick={() => previewAttachment(attachment)} title="预览"><Eye size={15} /></button>
                <button className="icon-btn" onClick={() => openAttachment(attachment)} title="打开"><ExternalLink size={15} /></button>
                <button className="icon-btn" onClick={() => downloadAttachment(attachment)} title="下载"><Download size={15} /></button>
                {!inTrash && (
                  <button className="icon-btn danger" onClick={() => deleteTaskAttachment?.(task.id, attachment.id)} title="删除到回收站">
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            ))}
            {!task.attachments?.length && <p className="muted">暂无附件</p>}
          </div>
        </aside>
      </section>

      <section className="detail-grid">
        <div className="panel">
          <div className="section-title"><h3>留言区</h3></div>
          {!inTrash && (
            <form className="comment-form" onSubmit={submitComment}>
              <p className="muted upload-hint">留言区的附件显示在<strong>每条留言下方</strong>（与右侧「SOP 和附件」不是同一处）。选择文件后须点<strong>提交留言与附件</strong>才会同步给他人。</p>
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                onPaste={(event) => {
                  const items = Array.from(event.clipboardData?.items || []);
                  const files = items
                    .filter((item) => item.kind === "file")
                    .map((item) => item.getAsFile())
                    .filter(Boolean);
                  if (files.length) addCommentDraftFiles(files);
                }}
                placeholder="输入留言，或直接粘贴图片/文件/视频"
              />
              <div className="comment-upload-row">
                <label className="ghost-btn">
                  <Upload size={16} /> 选择留言附件
                  <input
                    type="file"
                    multiple
                    className="hidden-input"
                    onChange={(event) => addCommentDraftFiles(event.target.files)}
                  />
                </label>
                {!!commentFiles.length && <small className="muted">待发送 {commentFiles.length} 个文件</small>}
              </div>
              {!!commentFiles.length && (
                <div className="comment-draft-files">
                  {commentFiles.map((file, index) => (
                    <div key={`${file.name}-${index}`} className="comment-draft-file">
                      <span>
                        <strong>{file.name}</strong>
                        <small>{Math.max(1, Math.round((file.size || 0) / 1024))} KB</small>
                      </span>
                      <button type="button" className="icon-btn danger" onClick={() => removeCommentDraftFile(index)} title="移除">
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <button className="primary-btn" type="submit" disabled={commentSubmitBusy}>
                <MessageSquareText size={17} /> {commentSubmitBusy ? "提交中…" : "提交留言与附件"}
              </button>
            </form>
          )}
          {inTrash && <p className="muted">回收站任务不支持新增留言。</p>}
          <OverlayScrollbarsComponent className="timeline comment-scrollable" options={SCROLLBAR_OPTIONS} defer>
            {(task.comments || []).map((item) => (
              <div key={item.id} className="timeline-item">
                <strong>{item.author}</strong>
                <p>{item.content}</p>
                {!!item.attachments?.length && (
                  <div className="attachment-list comment-attachment-list">
                    {item.attachments.map((attachment) => (
                      <div key={attachment.id} className="attachment-item">
                        <FilePlus2 size={16} />
                        <span>
                          <strong>{attachment.name}</strong>
                          <small>{attachment.uploader} · {formatTime(attachment.uploadedAt)}</small>
                        </span>
                        <button className="icon-btn" onClick={() => previewAttachment(attachment)} title="预览"><Eye size={14} /></button>
                        <button className="icon-btn" onClick={() => openAttachment(attachment)} title="打开"><ExternalLink size={14} /></button>
                        <button className="icon-btn" onClick={() => downloadAttachment(attachment)} title="下载"><Download size={14} /></button>
                        {!inTrash && (
                          <button
                            className="icon-btn danger"
                            onClick={() => deleteCommentAttachment?.(task.id, item.id, attachment.id)}
                            title="删除到回收站"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <small>{formatTime(item.time)}</small>
              </div>
            ))}
            {!task.comments?.length && <p className="muted">暂无留言</p>}
          </OverlayScrollbarsComponent>
        </div>
        <div className="panel timeline-panel">
          <div className="section-title"><h3>任务时间线</h3></div>
          <div className="timeline-toolbar">
            <label className="search-box timeline-search-box" data-tutorial="timeline-search">
              <Search size={16} />
              <input
                value={timelineQuery}
                onChange={(event) => setTimelineQuery(event.target.value)}
                placeholder="搜索时间线：操作人、动作、状态、模块"
              />
            </label>
            <small className="muted">当前显示 {visibleTimelineLogs.length} / {timelineLogs.length} 条</small>
          </div>
          <OverlayScrollbarsComponent className="timeline timeline-scrollable" options={TIMELINE_SCROLLBAR_OPTIONS} defer>
            {visibleTimelineLogs.map((item) => (
              <button
                key={item.id}
                type="button"
                className="timeline-item clickable"
                onClick={() => setSelectedLog(item)}
                title="点击查看详情"
              >
                <div className="timeline-item-head">
                  <strong>{isOrderAdjustAction(item.action) ? "顺序调整" : item.actor}</strong>
                  {!inTrash && (
                    <button
                      type="button"
                      className="icon-btn danger timeline-delete-btn"
                      title="删除这条时间线"
                      onClick={(event) => {
                        event.stopPropagation();
                        deleteLogEntry?.(task.id, item.id);
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
                <p>{item.action}</p>
                <small>
                  {formatTime(item.time)}
                  {item.snapshot ? ` · 状态：${item.snapshot.status} · 进度：${item.snapshot.progress}%` : ""}
                </small>
              </button>
            ))}
            {!visibleTimelineLogs.length && <p className="muted">没有匹配的时间线记录</p>}
          </OverlayScrollbarsComponent>
          {hasMoreTimelineLogs && (
            <div className="timeline-loadmore">
              <button
                className="ghost-btn"
                type="button"
                onClick={() => setTimelineVisibleCount((count) => Math.min(count + 120, timelineLogs.length))}
              >
                加载更多时间线
              </button>
            </div>
          )}
        </div>
      </section>
      {selectedLog && <LogDetailModal log={selectedLog} onClose={() => setSelectedLog(null)} />}
    </motion.div>
  );
}

function LogDetailModal({ log, onClose }) {
  const snapshot = log.snapshot || null;
  const details = log.details || null;
  const before = details?.before || null;
  const after = details?.after || snapshot || null;
  const changes = details?.changes || null;

  const downloadable = (att) => Boolean(att?.dataUrl);
  const openAtt = (att) => {
    if (!att?.dataUrl) {
      alert("这个附件没有可打开的本地内容；请重新上传文件后再查看。");
      return;
    }
    window.open(att.dataUrl, "_blank", "noopener,noreferrer");
  };
  const downloadAtt = (att) => {
    if (!att?.dataUrl) {
      alert("这个附件没有可下载的本地内容；新上传且小于 8MB 的文件可以直接下载。");
      return;
    }
    const link = document.createElement("a");
    link.href = att.dataUrl;
    link.download = att.name || "attachment";
    link.click();
  };

  const renderAttachments = (atts) => (
    <div className="attachment-list log-attachment-list">
      {(atts || []).map((att) => (
        <div key={att.id || att.name} className="attachment-item">
          <FilePlus2 size={17} />
          <span>
            <strong>{att.name}</strong>
            <small>{att.uploader || "-"} · {att.uploadedAt ? formatTime(att.uploadedAt) : "-"}</small>
          </span>
          <button className="icon-btn" onClick={() => openAtt(att)} title="打开" disabled={!downloadable(att)}><ExternalLink size={15} /></button>
          <button className="icon-btn" onClick={() => downloadAtt(att)} title="下载" disabled={!downloadable(att)}><Download size={15} /></button>
        </div>
      ))}
      {!(atts || []).length && <p className="muted">当时没有附件</p>}
    </div>
  );

  return (
    <div className="modal-backdrop" role="presentation">
      <motion.section className="task-modal log-modal" {...cinematicMotion}>
        <div className="modal-title">
          <div>
            <h2>时间线详情</h2>
            <p>{log.actor} · {formatTime(log.time)}</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="description-box">{log.action}</div>
        {after && (
          <div className="info-grid log-info-grid">
            <Info label="当时模块" value={after.module ?? "-"} />
            <Info label="当时状态" value={after.status ?? "-"} />
            <Info label="当时进度" value={after.progress !== undefined ? `${after.progress}%` : "-"} />
            <Info label="模块顺序" value={after.order ?? "-"} />
            <Info label="仪表盘顺序" value={after.dashboardOrder ?? "-"} />
          </div>
        )}

        {changes?.status && (
          <div className="panel log-diff-panel">
            <div className="section-title"><h3>状态变更详情</h3></div>
            <div className="info-grid log-info-grid">
              <Info label="变更前状态" value={changes.status.from} />
              <Info label="变更后状态" value={changes.status.to} />
              <Info
                label="变更前进度"
                value={changes.progress ? `${changes.progress.from}%` : before?.progress !== undefined ? `${before.progress}%` : "-"}
              />
              <Info
                label="变更后进度"
                value={changes.progress ? `${changes.progress.to}%` : after?.progress !== undefined ? `${after.progress}%` : "-"}
              />
            </div>
          </div>
        )}

        {(before?.attachments || after?.attachments) && (
          <div className="panel log-diff-panel">
            <div className="section-title"><h3>当时文件</h3></div>
            {renderAttachments(after?.attachments || [])}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="primary-btn" onClick={onClose}>关闭</button>
        </div>
      </motion.section>
    </div>
  );
}

function AttachmentPreviewModal({ attachment, onOpen, onDownload, onClose }) {
  const type = attachment.type || "";
  const isImage = type.startsWith("image/");
  const isVideo = type.startsWith("video/");
  const previewable = canPreviewAttachment(attachment);

  return (
    <div className="modal-backdrop preview-backdrop" role="presentation">
      <motion.section className="attachment-preview-modal" {...cinematicMotion}>
        <div className="modal-title">
          <div>
            <h2>{attachment.name}</h2>
            <p>{attachment.uploader} · {formatTime(attachment.uploadedAt)}</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="preview-frame">
          {!previewable && (
            <div className="preview-empty">
              <FilePlus2 size={30} />
              <strong>这个格式不支持内嵌预览</strong>
              <p>可以直接打开或下载查看。</p>
            </div>
          )}
          {previewable && isImage && <img src={attachment.dataUrl} alt={attachment.name} />}
          {previewable && isVideo && <video src={attachment.dataUrl} controls />}
          {previewable && !isImage && !isVideo && <iframe title={attachment.name} src={attachment.dataUrl} />}
        </div>
        <div className="modal-actions">
          <button type="button" className="ghost-btn" onClick={onOpen}><ExternalLink size={17} /> 打开</button>
          <button type="button" className="primary-btn" onClick={onDownload}><Download size={17} /> 下载</button>
        </div>
      </motion.section>
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div className="info-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TaskModal({ modal, users, isAdmin, onClose, onSave }) {
  const [form, setForm] = useState(() => ({ ...modal.task }));
  const isCreate = modal.mode === "create";

  const update = (key, value) => {
    setForm((current) => {
      const next = { ...current, [key]: value };
      if (key === "status") next.progress = statusProgress(value);
      return next;
    });
  };

  const submit = (event) => {
    event.preventDefault();
    if (!form.title.trim()) return;
    onSave(form);
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <motion.form className="task-modal" onSubmit={submit} {...cinematicMotion}>
        <div className="modal-title">
          <div>
            <h2>{isCreate ? "新增任务" : "编辑任务"}</h2>
            {isCreate && <p>只需要写清楚任务名字和具体需求，系统会自动排队并匹配优先级。</p>}
          </div>
          <button type="button" className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="form-grid">
          <label className="wide">
            <span>任务名称</span>
            <input value={form.title} onChange={(event) => update("title", event.target.value)} placeholder="例如 清关状态自动查询" required />
          </label>
          <label className="wide">
            <span>具体任务需求</span>
            <textarea value={form.demand} onChange={(event) => update("demand", event.target.value)} placeholder="把现在怎么做、想自动化成什么效果写清楚即可" required />
          </label>
          {!isCreate && (
            <>
              <label>
                <span>所属模块</span>
                <select value={form.module} onChange={(event) => update("module", event.target.value)}>
                  {MODULES.map((module) => <option key={module.key}>{module.label}</option>)}
                </select>
              </label>
              <label>
                <span>负责人</span>
                <input list="usernames" value={form.owner} onChange={(event) => update("owner", event.target.value)} />
                <datalist id="usernames">
                  {users.map((user) => <option key={user.id} value={user.username} />)}
                </datalist>
              </label>
              <label>
                <span>状态</span>
                <select value={form.status} onChange={(event) => update("status", event.target.value)}>
                  {Object.keys(STATUSES).map((item) => <option key={item}>{item}</option>)}
                </select>
              </label>
              {isAdmin && (
                <label className="wide">
                  <span>交付形式</span>
                  <input value={form.delivery || ""} onChange={(event) => update("delivery", event.target.value)} placeholder="管理员自由填写，例如 RPA流程 / Excel工具 / 内部网页功能" />
                </label>
              )}
            </>
          )}
        </div>
        <div className="modal-actions">
          <button type="button" className="ghost-btn" onClick={onClose}>取消</button>
          <button type="submit" className="primary-btn"><Save size={17} /> 保存</button>
        </div>
      </motion.form>
    </div>
  );
}

function TrashPage({
  data,
  query,
  setQuery,
  openTask,
  restoreTask,
  purgeTrashTask,
  restoreAttachment,
  purgeAttachmentTrash,
}) {
  const items = useMemo(() => {
    const needle = normalizeSearch(query);
    const list = [...(data.trash || [])].sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
    if (!needle) return list;
    return list.filter((task) => fuzzyScore(task, needle) >= 2);
  }, [data.trash, query]);
  const attachmentItems = useMemo(() => {
    const needle = normalizeSearch(query);
    const list = [...(data.attachmentTrash || [])].sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
    if (!needle) return list;
    return list.filter((item) =>
      normalizeSearch(`${item.name} ${item.taskTitle || ""} ${item.sourceType || ""}`).includes(needle),
    );
  }, [data.attachmentTrash, query]);

  return (
    <motion.div className="page-stack" {...cinematicMotion}>
      <section className="module-header">
        <div>
          <p className="eyebrow">Admin</p>
          <h1>回收站</h1>
          <p>回收站最多保留 7 天，过期会自动清理。</p>
        </div>
      </section>
      <section className="filter-bar trash-filter">
        <label className="search-box">
          <Search size={17} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索回收站任务" />
        </label>
      </section>
      <section className="task-grid trash-grid">
        {items.map((task) => (
          <article key={task.id} className="task-card trash-card">
            <div className="task-card-top">
              <button className="task-title-btn" onClick={() => openTask(task.id)}>{task.title}</button>
              <small className="muted">删除时间：{formatTime(task.deletedAt)}</small>
            </div>
            <p>{task.description || buildLatestSituation(task)}</p>
            <div className="meta-row">
              <span className={statusClass(task.status)}>{task.status}</span>
              <span>模块：{task.module}</span>
              <span>负责人：{task.owner}</span>
            </div>
            <div className="card-controls" onClick={(event) => event.stopPropagation()}>
              <button className="primary-btn" type="button" onClick={() => restoreTask(task.id)}>恢复</button>
              <button className="ghost-btn detail-open-btn" type="button" onClick={() => openTask(task.id)}>详情</button>
              <button className="ghost-btn danger" type="button" onClick={() => purgeTrashTask(task.id)}>彻底删除</button>
            </div>
          </article>
        ))}
        {!items.length && (
          <div className="empty-state">
            <Trash2 size={28} />
            <strong>回收站为空</strong>
            <p>删除的任务会在这里保留最多 7 天。</p>
          </div>
        )}
      </section>
      <section className="panel">
        <div className="panel-title"><FilePlus2 size={18} /><h3>附件回收站</h3></div>
        <div className="attachment-list">
          {attachmentItems.map((item) => (
            <div key={item.id} className="attachment-item">
              <FilePlus2 size={17} />
              <span>
                <strong>{item.name}</strong>
                <small>{item.taskTitle || "-"} · {item.sourceType === "comment" ? "留言附件" : "任务附件"} · {formatTime(item.deletedAt)}</small>
              </span>
              <button className="ghost-btn" type="button" onClick={() => restoreAttachment(item.id)}>恢复</button>
              <button className="ghost-btn danger" type="button" onClick={() => purgeAttachmentTrash(item.id)}>彻底删除</button>
            </div>
          ))}
          {!attachmentItems.length && <p className="muted">暂无附件回收记录</p>}
        </div>
      </section>
    </motion.div>
  );
}

function TutorialModal({ step, total, data, onPrev, onNext, onSkipStep, onSkipAll }) {
  const [targetRect, setTargetRect] = useState(null);
  const [allRects, setAllRects] = useState([]);
  const [coachPos, setCoachPos] = useState({ top: 24, left: 24 });
  const dragRef = useRef({ dragging: false, startX: 0, startY: 0, originTop: 0, originLeft: 0 });

  useEffect(() => {
    const updateRect = () => {
      const target = document.querySelector(data?.selector || "");
      const markers = Array.from(document.querySelectorAll("[data-tutorial]")).map((el) => {
        const rect = el.getBoundingClientRect();
        const key = el.getAttribute("data-tutorial") || "";
        return { key, top: rect.top, left: rect.left, width: rect.width, height: rect.height };
      });
      setAllRects(markers);
      if (!target) {
        setTargetRect(null);
        return;
      }
      const rect = target.getBoundingClientRect();
      setTargetRect({
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      });
    };
    updateRect();
    window.addEventListener("resize", updateRect);
    window.addEventListener("scroll", updateRect, true);
    return () => {
      window.removeEventListener("resize", updateRect);
      window.removeEventListener("scroll", updateRect, true);
    };
  }, [data?.selector, step]);

  useEffect(() => {
    if (!targetRect) return;
    const cardWidth = Math.min(420, window.innerWidth - 40);
    const cardHeight = 300;
    let top = targetRect.top + targetRect.height + 14;
    if (top + cardHeight > window.innerHeight - 14) {
      top = Math.max(14, targetRect.top - cardHeight - 14);
    }
    const left = Math.min(window.innerWidth - cardWidth - 14, Math.max(14, targetRect.left));
    setCoachPos({ top, left });
  }, [targetRect, step]);

  const handleDragStart = (event) => {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      dragging: true,
      startX: event.clientX,
      startY: event.clientY,
      originTop: coachPos.top,
      originLeft: coachPos.left,
    };
  };

  const handleDragMove = (event) => {
    if (!dragRef.current.dragging) return;
    const cardWidth = Math.min(420, window.innerWidth - 40);
    const nextLeft = dragRef.current.originLeft + (event.clientX - dragRef.current.startX);
    const nextTop = dragRef.current.originTop + (event.clientY - dragRef.current.startY);
    setCoachPos({
      left: Math.min(window.innerWidth - cardWidth - 10, Math.max(10, nextLeft)),
      top: Math.min(window.innerHeight - 210, Math.max(10, nextTop)),
    });
  };

  const handleDragEnd = () => {
    const cardWidth = Math.min(420, window.innerWidth - 40);
    const snapGap = 14;
    const centerX = coachPos.left + cardWidth / 2;
    const snapLeft = centerX < window.innerWidth / 2 ? snapGap : window.innerWidth - cardWidth - snapGap;
    const snappedTop = Math.min(window.innerHeight - 210, Math.max(10, coachPos.top));
    setCoachPos({ top: snappedTop, left: snapLeft });
    dragRef.current.dragging = false;
  };

  return (
    <div className="tutorial-overlay">
      {allRects.map((item) => (
        <div
          key={`${item.key}-${item.top}-${item.left}`}
          className={`tutorial-marker ${data?.selector?.includes(item.key) ? "active" : ""}`}
          style={{
            top: item.top - 4,
            left: item.left - 4,
            width: item.width + 8,
            height: item.height + 8,
          }}
        />
      ))}
      {targetRect && (
        <div
          className="tutorial-spotlight"
          style={{
            top: targetRect.top - 6,
            left: targetRect.left - 6,
            width: targetRect.width + 12,
            height: targetRect.height + 12,
          }}
        />
      )}
      <motion.div
        className="task-modal tutorial-modal tutorial-coach"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 24 }}
        transition={{ duration: 0.22 }}
        style={{ top: coachPos.top, left: coachPos.left }}
      >
        <div
          className="modal-title tutorial-drag-handle"
          onPointerDown={handleDragStart}
          onPointerMove={handleDragMove}
          onPointerUp={handleDragEnd}
          onPointerCancel={handleDragEnd}
        >
          <div>
            <p className="eyebrow">教学引导</p>
            <h3>{data?.title || "功能教学"}</h3>
          </div>
        </div>
        <div className="modal-body">
          <p>{data?.desc || "欢迎使用系统。"}</p>
          <p className="muted">步骤 {step + 1} / {total}</p>
        </div>
        <div className="modal-actions">
          <button className="ghost-btn" type="button" onClick={onSkipAll}>跳过全部</button>
          <button className="ghost-btn" type="button" onClick={onSkipStep}>跳过此步</button>
          <button className="ghost-btn" type="button" onClick={onPrev} disabled={step === 0}>上一步</button>
          <button className="primary-btn" type="button" onClick={onNext}>{step >= total - 1 ? "完成" : "下一步"}</button>
        </div>
      </motion.div>
    </div>
  );
}

export default App;
