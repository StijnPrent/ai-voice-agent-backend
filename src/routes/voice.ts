// src/routes/VoiceRoutes.ts
import { Router } from "express";
import { VoiceController } from "../controllers/VoiceController";

const router = Router();
const controller = new VoiceController();

// 1) Incoming call
router.post(
    "/voice/twilio/incoming",
    controller.handleIncomingCallTwilio.bind(controller)
);

// 2) Conversation loop
router.post(
    "/voice/twilio/conversation",
    controller.handleConversation.bind(controller)
);

// 3a) HEAD for TTS – Twilio does this first
router.head("/voice/tts", (_req, res) => {
    // Geef direct 200, geen body
    res.sendStatus(200);
});

// 3b) GET for TTS – jouw streaming handler
router.get(
    "/voice/tts",
    controller.tts.bind(controller)
);

export default router;
