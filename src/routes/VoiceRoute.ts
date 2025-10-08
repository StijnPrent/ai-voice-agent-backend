// src/routes/VoiceRoute.ts
import { Router } from "express";
import { VoiceController } from "../controllers/VoiceController";
import { verifyInternalApiKey } from "../middleware/security";
import { VoiceService } from "../business/services/VoiceService";

export function voiceRoutes(voiceService: VoiceService) {
  const router = Router();
  const controller = new VoiceController();

  router.post("/twilio/incoming", controller.handleIncomingCallTwilio.bind(controller));

  router.post("/transfer", verifyInternalApiKey, async (req, res) => {
    try {
      const { phoneNumber, callSid, callerId, reason } = req.body || {};
      if (!phoneNumber || typeof phoneNumber !== "string") {
        return res.status(400).json({ error: "phoneNumber is required" });
      }
      await voiceService.transferCall(phoneNumber, { callSid, callerId, reason });
      return res.json({ success: true, transferredTo: phoneNumber });
    } catch (e: any) {
      console.error("[/voice/transfer] error:", e);
      return res
        .status(409)
        .json({ success: false, error: e?.message || "transfer failed" });
    }
  });

  return router;
}

export default voiceRoutes;
