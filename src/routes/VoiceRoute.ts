// src/routes/VoiceRoute.ts
import { Router, Response } from "express";
import { VoiceController } from "../controllers/VoiceController";
import { VoiceSessionManager } from "../business/services/VoiceSessionManager";
import twilio from "twilio";

function respondWithTwiml(
  res: Response,
  configure?: (response: twilio.twiml.VoiceResponse) => void
) {
  const response = new twilio.twiml.VoiceResponse();
  if (configure) {
    configure(response);
  }

  res.type("text/xml");
  res.send(response.toString());
}

export function voiceRoutes(sessionManager: VoiceSessionManager) {
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
      const voiceService = sessionManager.getSession(callSid ?? undefined);
      if (!voiceService) {
        console.warn(
          `[/voice/twilio/status] No active session for callSid=${callSid ?? "unknown"}; active callSids=${sessionManager
            .listActiveCallSids()
            .join(",")}`
        );
      } else {
        voiceService.handleTwilioStatusCallback(callSid, callStatus, req.body ?? {});
      }
    } catch (error) {
      console.error("[/voice/twilio/status] Failed to process status callback", error);
    }

    res.status(200).send("OK");
  });

  router.post("/twilio/dial-action", async (req, res) => {
    const callSid = typeof req.body?.CallSid === "string" ? req.body.CallSid : undefined;
    const voiceService = sessionManager.getSession(callSid ?? undefined);

    if (!voiceService) {
      console.warn(
        `[/voice/twilio/dial-action] No active session for callSid=${callSid ?? "unknown"}; active callSids=${sessionManager
          .listActiveCallSids()
          .join(",")}`
      );
    } else {
      voiceService.handleDialCallback("action", req.body ?? {});
    }

    respondWithTwiml(res, (response) => {
      response.hangup();
    });
  });

  router.post("/twilio/dial-status", async (req, res) => {
    const callSid = typeof req.body?.CallSid === "string" ? req.body.CallSid : undefined;
    const voiceService = sessionManager.getSession(callSid ?? undefined);

    if (!voiceService) {
      console.warn(
        `[/voice/twilio/dial-status] No active session for callSid=${callSid ?? "unknown"}; active callSids=${sessionManager
          .listActiveCallSids()
          .join(",")}`
      );
    } else {
      voiceService.handleDialCallback("status", req.body ?? {});
    }

    res.status(200).send("OK");
  });

  router.post("/transfer", async (req, res) => {
    try {
      const { phoneNumber, callSid, callerId, reason } = req.body || {};
      if (!phoneNumber || typeof phoneNumber !== "string") {
        res.status(400).json({ error: "phoneNumber is required" });
        return;
      }
      const voiceService = sessionManager.resolveActiveSession(callSid);
      if (!voiceService) {
        const activeSessions = sessionManager.listActiveCallSids();
        res.status(409).json({
          success: false,
          error:
            callSid || activeSessions.length === 0
              ? "Er is geen actieve oproep met het opgegeven callSid."
              : "Er zijn meerdere actieve oproepen; specificeer callSid.",
        });
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
