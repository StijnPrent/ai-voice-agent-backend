// src/routes/VoiceRoute.ts
import { Router, Response } from "express";
import { VoiceController } from "../controllers/VoiceController";
import { VoiceSessionManager } from "../business/services/VoiceSessionManager";
import twilio from "twilio";
import { container } from "tsyringe";
import { CompanyService } from "../business/services/CompanyService";

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
  const companyService = container.resolve(CompanyService);

  const parseCompanyId = (input: unknown): bigint | null => {
    if (typeof input === "undefined" || input === null) {
      return null;
    }

    if (typeof input === "bigint") {
      return input;
    }

    if (typeof input === "number") {
      if (!Number.isFinite(input)) {
        throw new Error("companyId must be a finite number");
      }
      return BigInt(Math.trunc(input));
    }

    if (typeof input === "string") {
      const trimmed = input.trim();
      if (!trimmed) {
        return null;
      }

      try {
        return BigInt(trimmed);
      } catch {
        throw new Error("companyId must be a numeric string");
      }
    }

    throw new Error("Unsupported companyId type");
  };

  const resolveCompany = async (
    companyIdInput: unknown,
    twilioNumberInput: unknown
  ) => {
    const parsedCompanyId = parseCompanyId(companyIdInput);
    if (parsedCompanyId !== null) {
      return companyService.findById(parsedCompanyId);
    }

    if (typeof twilioNumberInput === "string" && twilioNumberInput.trim()) {
      return companyService.findByTwilioNumber(twilioNumberInput.trim());
    }

    return null;
  };

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

  router.post("/assistant/state", async (req, res) => {
    try {
      const { enabled, companyId, twilioNumber } = req.body ?? {};

      if (typeof enabled !== "boolean") {
        res.status(400).json({ error: "'enabled' must be a boolean value." });
        return;
      }

      const company = await resolveCompany(companyId, twilioNumber);
      if (!company) {
        res
          .status(400)
          .json({ error: "Provide a valid companyId or twilioNumber to toggle the assistant." });
        return;
      }

      await companyService.setAssistantEnabled(company.id, enabled);
      const updated = await companyService.findById(company.id);

      res.json({
        success: true,
        companyId: updated.id.toString(),
        twilioNumber: updated.twilioNumber ?? null,
        enabled: updated.assistantEnabled,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      const status = message === "Company not found" ? 404 : 400;
      res.status(status).json({ error: message });
    }
  });

  router.get("/assistant/state", async (req, res) => {
    const rawCompanyId = req.query?.companyId;
    const rawTwilioNumber = req.query?.twilioNumber;
    const normalizedCompanyId = Array.isArray(rawCompanyId)
      ? rawCompanyId[0]
      : typeof rawCompanyId === "string" || typeof rawCompanyId === "number" || typeof rawCompanyId === "bigint"
      ? rawCompanyId
      : undefined;
    const normalizedTwilioNumber = Array.isArray(rawTwilioNumber)
      ? rawTwilioNumber[0]
      : typeof rawTwilioNumber === "string"
      ? rawTwilioNumber
      : undefined;

    try {
      const company = await resolveCompany(normalizedCompanyId, normalizedTwilioNumber);
      if (!company) {
        res
          .status(400)
          .json({ error: "Provide a companyId or twilioNumber to retrieve assistant state." });
        return;
      }

      res.json({
        companyId: company.id.toString(),
        twilioNumber: company.twilioNumber ?? null,
        enabled: company.assistantEnabled,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      const status = message === "Company not found" ? 404 : 400;
      res.status(status).json({ error: message });
    }
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
