import { Router } from "express";
import { container, injectable } from "tsyringe";
import type { VoiceService } from "../business/services/VoiceService";
import { VoiceSessionManager } from "../business/services/VoiceSessionManager";
import { VapiClient } from "../clients/VapiClient";

@injectable()
export class VapiRoute {
  private readonly router: Router;

  constructor(private readonly sessionManager: VoiceSessionManager) {
    this.router = Router();
    this.registerRoutes();
  }

  public getRouter(): Router {
    return this.router;
  }

  private registerRoutes() {
    this.router.post("/tools", async (req, res) => {
      try {
        const headerCallIdRaw = req.headers["x-vapi-call-id"] ?? req.headers["x-vapi-callid"];
        const headerCallId = Array.isArray(headerCallIdRaw)
          ? headerCallIdRaw.find((value) => typeof value === "string" && value.trim().length > 0) ?? null
          : typeof headerCallIdRaw === "string"
          ? headerCallIdRaw
          : null;
        const normalizedHeaderCallId =
          typeof headerCallId === "string" && headerCallId.trim().length > 0
            ? headerCallId.trim()
            : null;

        const bodyCallId = VapiClient.extractCallIdFromWebhook(req.body);
        const callId = normalizedHeaderCallId ?? bodyCallId ?? null;
        console.log(
          `[VapiRoute] 📬 Received tool webhook for callId=${callId ?? "<none>"} (header=${
            normalizedHeaderCallId ?? "<none>"
          }, body=${bodyCallId ?? "<none>"})`,
        );
        const activeCallSids = this.sessionManager.listActiveCallSids();
        console.log(
          `[VapiRoute] 🔍 Extracted callId=${callId ?? "<none>"} (activeCallSids=${
            activeCallSids.length > 0 ? activeCallSids.join(", ") : "<none>"
          })`,
        );

        const voiceService = this.resolveVoiceService(req.body, callId);
        if (voiceService) {

        } else {
          console.warn(`[VapiRoute] ⚠️ Falling back to transient VapiClient for tool webhook`);
        }

        const result = voiceService
          ? await voiceService.handleVapiToolWebhook(req.body)
          : await container.resolve(VapiClient).handleToolWebhookRequest(req.body);
        res.status(200).json(result);
      } catch (error) {
        console.error("[VapiRoute] Tool webhook error", error);
        res.status(200).json({
          results: [
            {
              toolCallId: this.extractToolCallId(req.body) ?? "unknown",
              result: this.sanitizeErrorMessage(error),
            },
          ],
        });
      }
    });
  }

  private resolveVoiceService(body: unknown, explicitCallId?: string | null): VoiceService | undefined {
    const callId = explicitCallId ?? VapiClient.extractCallIdFromWebhook(body);
    if (callId) {
      const byCallId = this.sessionManager.findSessionByVapiCallId(callId);
      if (byCallId) {
        return byCallId;
      }

      const byCallSid = this.sessionManager.getSession(callId);
      if (byCallSid) {
        return byCallSid;
      }
    }

    return this.sessionManager.resolveActiveSession();
  }

  private extractToolCallId(body: unknown): string | null {
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
  }

  private sanitizeErrorMessage(error: unknown): string {
    const fallback = "Unhandled server error in tool webhook";

    if (!error) {
      return fallback;
    }

    const rawMessage =
      typeof error === "string"
        ? error
        : error instanceof Error
        ? error.message
        : String(error);

    const sanitized = rawMessage.replace(/[\r\n\t]+/g, " ").trim();
    return sanitized.length > 0 ? sanitized : fallback;
  }
}

export default VapiRoute;
