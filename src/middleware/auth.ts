// src/middleware/auth.ts
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export interface AuthenticatedRequest extends Request {
    companyId?: bigint;
}

export const authenticateToken = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers["authorization"];
    const token = authHeader?.split(" ")[1];

    if (!token) {
        res.status(401).json({ message: "Missing authentication token." });
        return;
    }

    jwt.verify(token, process.env.JWT_SECRET as string, (err: unknown, payload: any) => {
        if (err || !payload?.companyId) {
            res.status(401).json({ message: "Invalid or expired authentication token." });
            return;
        }

        try {
            req.companyId = BigInt(payload.companyId);
        } catch {
            res.status(401).json({ message: "Invalid authentication token payload." });
            return;
        }

        next();
    });
};