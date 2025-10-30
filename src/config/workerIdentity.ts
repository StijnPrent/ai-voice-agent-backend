import crypto from "crypto";

const envWorkerId = (process.env.WORKER_ID ?? "").trim();
const generatedWorkerId = envWorkerId || `worker-${crypto.randomUUID()}`;

const envInternalUrl = (process.env.WORKER_INTERNAL_URL ?? "").trim();
const normalizedInternalUrl = envInternalUrl ? envInternalUrl.replace(/\/+$/, "") : null;

const envProxyToken = (process.env.INTERNAL_TOOL_PROXY_TOKEN ?? "").trim();
const proxyToken = envProxyToken || null;

export const workerIdentity = {
  id: generatedWorkerId,
  internalUrl: normalizedInternalUrl,
  proxyToken,
} as const;

export const getWorkerId = () => workerIdentity.id;
export const getWorkerInternalUrl = () => workerIdentity.internalUrl;
export const getInternalToolProxyToken = () => workerIdentity.proxyToken;
