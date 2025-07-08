// src/routes/VoiceRoute.ts
import { Router } from "express";
import { VoiceController } from "../controllers/VoiceController";

const router = Router();
const controller = new VoiceController();

// Twilio-webhook voor een binnenkomende call
router.post(
    "/twilio/incoming",
    controller.handleIncomingCallTwilio.bind(controller)
);

export default router;
