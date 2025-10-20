// src/routes/VoiceRoute.ts
import { Router } from "express";
import { container } from "tsyringe";
import { VoiceController } from "../controllers/VoiceController";
import { VoiceSessionManager } from "../business/services/VoiceSessionManager";
import { VapiClient } from "../clients/VapiClient";

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

  router.post("/vapi/tool", async (req, res) => {
    const vapiClient = container.resolve(VapiClient);

    const extractToolCallId = (body: any): string | null => {
      if (!body || typeof body !== "object") {
        return null;
      }

      const candidates: unknown[] = [
        (body as any).toolCallId,
        (body as any).tool_call_id,
        (body as any).tool?.id,
        (body as any).toolCall?.id,
        (body as any).tool_call?.id,
      ];

      for (const candidate of candidates) {
        if (typeof candidate === "string") {
          const trimmed = candidate.trim();
          if (trimmed) {
            return trimmed;
          }
        }
      }

      return null;
    };

    try {
      const result = await vapiClient.handleToolWebhookRequest(req.body);
      res.status(200).json({ results: [result] });
    } catch (error) {
      console.error("[/voice/vapi/tool] Failed to handle tool webhook", error);
      const fallbackToolCallId = extractToolCallId(req.body) ?? `tool_${Date.now()}`;
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Onbekende fout bij verwerken van tool webhook.";
      const sanitizedError = (errorMessage ?? "Onbekende fout bij verwerken van tool webhook.")
        .toString()
        .replace(/[\r\n]+/g, " ")
        .trim();
      res.status(200).json({
        results: [
          {
            toolCallId: fallbackToolCallId,
            error: sanitizedError.length > 0 ? sanitizedError : "Onbekende fout bij verwerken van tool webhook.",
          },
        ],
      });
    }
  });

  return router;
}

export default voiceRoutes;
