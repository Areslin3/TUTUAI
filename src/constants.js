export const MODULES = [
  { key: "关务", label: "关务", description: "报关、清关、资料与文件自动化", tone: "customs" },
  { key: "操作", label: "操作", description: "订单、轨迹、异常件与仓库协同", tone: "ops" },
  { key: "客服", label: "客服", description: "消息、工单、客户问题与归档", tone: "service" },
  { key: "其他", label: "其他", description: "财务、审批、看板与内部工具", tone: "other" },
];

export const STATUSES = {
  待制作: { color: "gray", progress: 0 },
  制作中: { color: "blue", progress: 50 },
  待修改: { color: "red", progress: 50 },
  修改中: { color: "orange", progress: 75 },
  已完成: { color: "teal", progress: 100 },
};

export const PRIORITIES = {
  P0: { label: "最高优先级", weight: 0 },
  P1: { label: "高优先级", weight: 1 },
  P2: { label: "中优先级", weight: 2 },
  P3: { label: "低优先级", weight: 3 },
};

export const DEFAULT_USERS = [
  { id: "u-ares", username: "Ares", password: "123456", role: "管理员", tutorialDone: true },
];
