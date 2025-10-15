import { Router } from "express";
import { authenticateToken } from "../middleware/auth";
import { AnalyticsController } from "../controllers/AnalyticsController";

const router = Router();
const controller = new AnalyticsController();

router.get("/calls/overview", authenticateToken, controller.getCallOverview.bind(controller));

export default router;
