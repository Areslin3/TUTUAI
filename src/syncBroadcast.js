const CHANNEL_NAME = "tutu-app-state-v1";

/** 同浏览器多标签页即时通知云端版本变化，减少仅依赖轮询的延迟 */
export const createSyncBroadcast = (onPeerUpdated) => {
  if (typeof BroadcastChannel === "undefined") {
    return { notifyCloudUpdated: () => {}, close: () => {} };
  }

  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (event) => {
    const data = event?.data;
    if (data?.type !== "cloud-updated" || !data.updatedAt) return;
    onPeerUpdated(data.updatedAt);
  };

  return {
    notifyCloudUpdated: (updatedAt) => {
      channel.postMessage({ type: "cloud-updated", updatedAt });
    },
    close: () => channel.close(),
  };
};
