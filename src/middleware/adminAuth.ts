import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

export interface AdminAuthenticatedRequest extends Request {
    adminId?: number;
}

export function authenticateAdminToken(
    req: AdminAuthenticatedRequest,
    res: Response,
    next: NextFunction
): void {
    const authHeader = req.headers["authorization"];
    const token = authHeader?.split(" ")[1];

    if (!token) {
        res.status(401).json({ success: false, error: "Missing authentication token." });
        return;
    }

    jwt.verify(token, process.env.JWT_SECRET as string, (error, payload) => {
        if (error || !payload || typeof payload !== "object") {
            res.status(401).json({ success: false, error: "Invalid or expired token." });
            return;
        }

        const adminId = (payload as { adminId?: number }).adminId;
        if (!adminId || !Number.isFinite(adminId)) {
            res.status(401).json({ success: false, error: "Invalid token payload." });
            return;
        }

        req.adminId = Number(adminId);
        next();
    });
}
