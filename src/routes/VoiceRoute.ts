// src/routes/VoiceRoute.ts
import { Router } from "express";
import { VoiceController } from "../controllers/VoiceController";
import { verifyInternalApiKey } from "../middleware/internalApiKey";

const router = Router();
const controller = new VoiceController();

// Twilio-webhook voor een binnenkomende call
router.post(
    "/twilio/incoming",
    controller.handleIncomingCallTwilio.bind(controller)
);

router.post(
    "/transfer",
    verifyInternalApiKey,
    controller.transferActiveCall.bind(controller)
);

export default router;
