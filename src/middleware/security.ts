// src/middleware/security.ts
import { Request, Response, NextFunction } from "express";

export function verifyInternalApiKey(req: Request, res: Response, next: NextFunction) {
  const configured = process.env.INTERNAL_API_KEY;
  if (!configured) {
    console.warn("[Security] INTERNAL_API_KEY not set — allowing all requests (dev).");
    return next();
  }
  const incoming = String(req.headers["x-internal-api-key"] ?? "");
  if (incoming !== configured) return res.status(403).json({ error: "Forbidden" });
  next();
}
