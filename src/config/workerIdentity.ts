import crypto from "crypto";

const envWorkerId = (process.env.WORKER_ID ?? "").trim();
const generatedWorkerId = envWorkerId || `worker-${crypto.randomUUID()}`;

const envProxyToken = (process.env.INTERNAL_TOOL_PROXY_TOKEN ?? "").trim();
const proxyToken = envProxyToken.length > 0 ? envProxyToken : null;

export const workerIdentity = {
  id: generatedWorkerId,
  proxyToken,
} as const;

export const getWorkerId = () => workerIdentity.id;
