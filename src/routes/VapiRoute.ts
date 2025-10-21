import { Router } from "express";
import { container, injectable } from "tsyringe";
import type { VoiceService } from "../business/services/VoiceService";
import { VoiceSessionManager } from "../business/services/VoiceSessionManager";
import { VapiClient, type VapiToolLogContext } from "../clients/VapiClient";

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
        const callId = VapiClient.extractCallIdFromWebhook(req.body);
        const toolCallId = this.extractToolCallId(req.body);
        const toolContext: VapiToolLogContext = {
          callId: callId ?? null,
          toolCallId,
        };
        const contextLabel = VapiClient.formatToolLogContext(toolContext);

        this.logJsonPreview(`[VapiRoute] ⇦ Incoming tool webhook body ${contextLabel}`, req.body);

        const activeCallSids = this.sessionManager.listActiveCallSids();
        console.log(
          `[VapiRoute] 🔍 Extracted callId=${callId ?? "<none>"}, toolCallId=${
            toolCallId ?? "<none>"
          } ${contextLabel} (activeCallSids=${
            activeCallSids.length > 0 ? activeCallSids.join(", ") : "<none>"
          })`,
        );

        const voiceService = this.resolveVoiceService(req.body, callId);
        if (voiceService) {
          toolContext.callSid = voiceService.getCallSid?.() ?? toolContext.callSid ?? null;
          const resolvedContext = VapiClient.formatToolLogContext(toolContext);
          console.log(
            `[VapiRoute] 🧭 Resolved active VoiceService for webhook ${resolvedContext}`,
            this.describeVoiceService(voiceService),
          );
        } else {
          console.warn(
            `[VapiRoute] ⚠️ Falling back to transient VapiClient for tool webhook ${contextLabel}`,
          );
        }

        const result = voiceService
          ? await voiceService.handleVapiToolWebhook(req.body)
          : await container.resolve(VapiClient).handleToolWebhookRequest(req.body);

        const responseContextLabel = VapiClient.formatToolLogContext(toolContext);
        this.logJsonPreview(`[VapiRoute] ⇨ Tool webhook response ${responseContextLabel}`, result);
        res.status(200).json(result);
      } catch (error) {
        console.error("[VapiRoute] Tool webhook error", error);
        const contextLabel = VapiClient.formatToolLogContext({
          callId: VapiClient.extractCallIdFromWebhook(req.body),
          toolCallId: this.extractToolCallId(req.body),
        });
        this.logJsonPreview(
          `[VapiRoute] ⇨ Tool webhook error response payload ${contextLabel}`,
          error,
        );
        res.status(200).json({
          results: [
            {
              toolCallId: this.extractToolCallId(req.body) ?? "unknown",
              error: this.sanitizeErrorMessage(error),
            },
          ],
        });
      }
    });
  }

  private resolveVoiceService(body: unknown, providedCallId?: string | null): VoiceService | undefined {
    const callId = providedCallId ?? VapiClient.extractCallIdFromWebhook(body);
    console.log(`[VapiRoute] 🔁 Resolving VoiceService (callId=${callId ?? "<none>"})`);
    if (callId) {
      const byCallId = this.sessionManager.findSessionByVapiCallId(callId);
      if (byCallId) {
        console.log(`[VapiRoute] ✅ Found session by Vapi callId ${callId}`);
        return byCallId;
      }

      const byCallSid = this.sessionManager.getSession(callId);
      if (byCallSid) {
        console.log(`[VapiRoute] ✅ Found session by callSid ${callId}`);
        return byCallSid;
      }

      console.warn(`[VapiRoute] ⚠️ No session found for callId ${callId}`);
    }

    const fallback = this.sessionManager.resolveActiveSession();
    if (fallback) {
      console.log(`[VapiRoute] ℹ️ Using single active session as fallback`);
    } else {
      console.warn(`[VapiRoute] ⚠️ Unable to resolve active session for tool webhook`);
    }

    return fallback;
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

  private logJsonPreview(label: string, value: unknown, limit = 4000) {
    try {
      const serialized = JSON.stringify(value, null, 2);
      if (!serialized) {
        console.log(`${label}: <empty>`);
        return;
      }

      if (serialized.length <= limit) {
        console.log(`${label}: ${serialized}`);
        return;
      }

      console.log(
        `${label}: ${serialized.slice(0, limit)}… (truncated ${serialized.length - limit} chars)`,
      );
    } catch (error) {
      console.log(`${label}: [unserializable: ${(error as Error)?.message ?? "unknown"}]`);
    }
  }

  private describeVoiceService(service: VoiceService) {
    return {
      callSid: service.getCallSid?.() ?? "<unknown>",
      vapiCallId: service.getVapiCallId?.() ?? "<unknown>",
    };
  }
}

export default VapiRoute;
