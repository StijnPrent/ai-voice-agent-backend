import { Router } from "express";
import { authenticateToken } from "../middleware/auth";
import {IntegrationController} from "../controllers/IntegrationController";

const router = Router();
const controller = new IntegrationController();

router.get("/get", authenticateToken, controller.getAllIntegrations.bind(controller));
router.get("/has-calendar-connected/:id", controller.hasCalendarConnected.bind(controller));

export default router;
