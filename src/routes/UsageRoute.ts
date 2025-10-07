// src/routes/UsageRoute.ts
import { Router } from "express";
import { authenticateToken } from "../middleware/auth";
import { UsageController } from "../controllers/UsageController";

const router = Router();
const controller = new UsageController();

router.get(
    "/monthly",
    authenticateToken,
    controller.getMonthlyUsage.bind(controller)
);

export default router;
