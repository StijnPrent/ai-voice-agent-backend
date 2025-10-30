import axios from "axios";
import { Router } from "express";
import { inject, injectable } from "tsyringe";
import type { VoiceService } from "../business/services/VoiceService";
import { VoiceSessionManager } from "../business/services/VoiceSessionManager";
import { VapiClient } from "../clients/VapiClient";
import { VapiSessionRegistry, VapiSessionRecord } from "../business/services/VapiSessionRegistry";
import { workerIdentity } from "../config/workerIdentity";

@injectable()
export class VapiRoute {
  private readonly router: Router;
  private readonly workerId = workerIdentity.id;
  private readonly proxyToken = workerIdentity.proxyToken;

  constructor(
    private readonly sessionManager: VoiceSessionManager,
    @inject(VapiSessionRegistry) private readonly sessionRegistry: VapiSessionRegistry,
    @inject(VapiClient) private readonly vapiClient: VapiClient,
  ) {
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

        const registryEntry = await this.sessionRegistry.findSession(callId);
        if (registryEntry) {
          console.log(
            `[VapiRoute] 📦 Registry entry for callId=${callId}: workerId=${registryEntry.workerId}, address=${registryEntry.workerAddress ?? "<none>"}`,
          );
        } else if (callId) {
          console.log(`[VapiRoute] 📭 No registry entry found for callId=${callId}`);
        }

        const proxied = await this.tryProxyWebhook(registryEntry, req.body, normalizedHeaderCallId ?? bodyCallId ?? null);
        if (proxied) {
          res.status(proxied.status).json(proxied.payload);
          return;
        }

        const voiceService = this.resolveVoiceService(req.body, callId);
        if (!voiceService) {
          console.warn(`[VapiRoute] ⚠️ Falling back to transient VapiClient for tool webhook`);
        }

        const result = voiceService
          ? await voiceService.handleVapiToolWebhook(req.body)
          : await this.vapiClient.handleToolWebhookRequest(req.body);
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

  private async tryProxyWebhook(
    registryEntry: VapiSessionRecord | null,
    body: unknown,
    callId: string | null,
  ): Promise<{ status: number; payload: unknown } | null> {
    if (!registryEntry) {
      return null;
    }

    if (!registryEntry.workerId || registryEntry.workerId === this.workerId) {
      return null;
    }

    if (!registryEntry.workerAddress) {
      console.warn(
        `[VapiRoute] ⚠️ Registry entry for callId=${registryEntry.callId} is missing worker address. Cannot proxy request.`,
      );
      return null;
    }

    const targetUrl = this.buildProxyUrl(registryEntry.workerAddress);
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (this.proxyToken) {
      headers["x-internal-tool-proxy-token"] = this.proxyToken;
    }
    if (callId) {
      headers["x-vapi-call-id"] = callId;
    }

    try {
      console.log(
        `[VapiRoute] 🔁 Proxying tool webhook for callId=${registryEntry.callId} to worker=${registryEntry.workerId} (${targetUrl})`,
      );
      const response = await axios.post(targetUrl, body, {
        headers,
        timeout: 10000,
      });
      return { status: response.status, payload: response.data };
    } catch (error) {
      console.error(
        `[VapiRoute] ❌ Failed to proxy tool webhook to worker=${registryEntry.workerId} (${targetUrl})`,
        error,
      );
      return null;
    }
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

  private buildProxyUrl(base: string): string {
    const normalizedBase = base.replace(/\/$/, "");
    return `${normalizedBase}/tools`;
  }
}

export default VapiRoute;
