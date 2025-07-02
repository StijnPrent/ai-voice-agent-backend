import { Router } from "express";
import { VoiceController } from "../controllers/VoiceController";

const router = Router();
const controller = new VoiceController();
router.post("/twilio/conversation", controller.handleConversation.bind(controller));
router.get("/tts", controller.tts.bind(controller));
export default router;