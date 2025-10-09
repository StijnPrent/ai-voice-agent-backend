// src/routes/VoiceRoute.ts
import { Router } from "express";
import { VoiceController } from "../controllers/VoiceController";
import { verifyInternalApiKey } from "../middleware/security";
import { VoiceService } from "../business/services/VoiceService";

export function voiceRoutes(voiceService: VoiceService) {
  const router = Router();
  const controller = new VoiceController();

  router.post("/twilio/incoming", async (req, res, next) => {
    try {
      await controller.handleIncomingCallTwilio(req, res);
    } catch (error) {
      next(error);
    }
  });

  router.post("/twilio/status", async (req, res) => {
    try {
      const callSid = typeof req.body?.CallSid === "string" ? req.body.CallSid : undefined;
      const callStatus = typeof req.body?.CallStatus === "string" ? req.body.CallStatus : undefined;
      voiceService.handleTwilioStatusCallback(callSid, callStatus, req.body ?? {});
    } catch (error) {
      console.error("[/voice/twilio/status] Failed to process status callback", error);
    }

    res.status(200).send("OK");
  });

  router.post("/transfer", verifyInternalApiKey, async (req, res) => {
    try {
      const { phoneNumber, callSid, callerId, reason } = req.body || {};
      if (!phoneNumber || typeof phoneNumber !== "string") {
        res.status(400).json({ error: "phoneNumber is required" });
        return;
      }
      await voiceService.transferCall(phoneNumber, { callSid, callerId, reason });
      res.json({ success: true, transferredTo: phoneNumber });
      return;
    } catch (e: any) {
      console.error("[/voice/transfer] error:", e);
      res
        .status(409)
        .json({ success: false, error: e?.message || "transfer failed" });
      return;
    }
  });

  return router;
}

export default voiceRoutes;
