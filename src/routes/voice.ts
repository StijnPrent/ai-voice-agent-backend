import { Router } from "express";
import { verifyInternalApiKey } from "../middleware/security";
import { VoiceService } from "../business/services/VoiceService";
import { VoiceController } from "../controllers/VoiceController";

export function voiceRoutes(voiceService: VoiceService) {
    const router = Router();
    const controller = new VoiceController();

    router.post(
        "/voice/twilio/incoming",
        controller.handleIncomingCallTwilio.bind(controller)
    );

    router.post("/voice/transfer", verifyInternalApiKey, async (req, res) => {
        try {
            const { phoneNumber, callSid, callerId, reason } = req.body || {};
            if (!phoneNumber || typeof phoneNumber !== "string") {
                res.status(400).json({ error: "phoneNumber is required" });
                return;
            }

            await voiceService.transferCall(phoneNumber, { callSid, callerId, reason });
            res.json({ success: true, transferredTo: phoneNumber });
        } catch (e: any) {
            console.error("[/voice/transfer] error:", e);
            const message = e?.message || "transfer failed";
            res.status(409).json({ success: false, error: message });
        }
    });

    return router;
}

export default voiceRoutes;
