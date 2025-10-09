// src/middleware/security.ts
import { Request, Response, NextFunction } from "express";

export function verifyInternalApiKey(req: Request, res: Response, next: NextFunction): void {
  const configured = process.env.INTERNAL_API_KEY;
  if (!configured) {
    console.warn("[Security] INTERNAL_API_KEY not set — allowing all requests (dev).");
    next();
    return;
  }
  const incoming = String(req.headers["x-internal-api-key"] ?? "");
  if (incoming !== configured) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}
