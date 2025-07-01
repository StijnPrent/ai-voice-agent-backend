import { Router } from "express";
import { VoiceController } from "../controllers/VoiceController";

const router = Router();
const controller = new VoiceController();
router.post("/twilio/callback", controller.handleIncomingCallTwilio.bind(controller));
router.get("/test-local", controller.handleLocalTest.bind(controller));
export default router;