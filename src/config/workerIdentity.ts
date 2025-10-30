import crypto from "crypto";

const envWorkerId = (process.env.WORKER_ID ?? "").trim();
const generatedWorkerId = envWorkerId || `worker-${crypto.randomUUID()}`;

export const workerIdentity = {
  id: generatedWorkerId,
} as const;

export const getWorkerId = () => workerIdentity.id;
