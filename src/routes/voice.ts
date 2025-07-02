// src/routes/VoiceRoutes.ts
import { Router } from "express";
import { VoiceController } from "../controllers/VoiceController";

const router = Router();
const controller = new VoiceController();

// 1) Bij binnenkomende call: speel welkom + start Gather
router.post(
    "/twilio/incoming",
    controller.handleIncomingCallTwilio.bind(controller)
);

// 2) Na elke SpeechResult: AI → TTS + nieuwe Gather
router.post(
    "/twilio/conversation",
    controller.handleConversation.bind(controller)
);

// 3) TTS-streaming endpoint voor ElevenLabs
router.get(
    "/tts",
    controller.tts.bind(controller)
);

export default router;
