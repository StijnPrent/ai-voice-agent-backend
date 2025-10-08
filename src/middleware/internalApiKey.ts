// src/middleware/internalApiKey.ts
import { NextFunction, Request, Response } from "express";

export const verifyInternalApiKey = (req: Request, res: Response, next: NextFunction) => {
    const expectedKey = process.env.INTERNAL_API_KEY;
    if (!expectedKey) {
        // If no key is configured we allow the request but log once for visibility.
        if (!req.app.get("__internal_api_key_warning_logged")) {
            console.warn("[verifyInternalApiKey] INTERNAL_API_KEY is not set; allowing all requests.");
            req.app.set("__internal_api_key_warning_logged", true);
        }
        next();
        return;
    }

    const providedKey = req.header("x-internal-api-key");
    if (!providedKey || providedKey !== expectedKey) {
        res.status(403).json({ error: "Forbidden" });
        return;
    }

    next();
};
