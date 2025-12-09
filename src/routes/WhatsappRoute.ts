import { Router } from "express";
import { WhatsappController } from "../controllers/WhatsappController";
import { authenticateToken } from "../middleware/auth";

const router = Router();
const controller = new WhatsappController();

router.get("/webhook", controller.verifyWebhook.bind(controller));
router.post("/webhook", controller.receiveWebhook.bind(controller));

router.post("/integration", authenticateToken, controller.upsertIntegration.bind(controller));
router.get("/integration", authenticateToken, controller.getIntegration.bind(controller));

export default router;
