// src/routes/VoiceSettingsRoute.ts
import { Router } from "express";
import { VoiceSettingsController } from "../controllers/VoiceSettingsController";
import { authenticateToken } from "../middleware/auth";

const router = Router();
const controller = new VoiceSettingsController();

router.get("/settings", authenticateToken, controller.getVoiceSettings.bind(controller));
router.put("/settings", authenticateToken, controller.updateVoiceSettings.bind(controller));
router.post("/settings", authenticateToken, controller.insertVoiceSettings.bind(controller));
router.get("/reply-style", authenticateToken, controller.getReplyStyle.bind(controller));
router.put("/reply-style", authenticateToken, controller.updateReplyStyle.bind(controller));
router.post("/reply-style", authenticateToken, controller.insertReplyStyle.bind(controller));

export default router;
