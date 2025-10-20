import { Router } from "express";
import { injectable } from "tsyringe";
import { VapiClient } from "../clients/VapiClient";

@injectable()
export class VapiRoute {
  private readonly router: Router;

  constructor(private readonly vapiClient: VapiClient) {
    this.router = Router();
    this.registerRoutes();
  }

  public getRouter(): Router {
    return this.router;
  }

  private registerRoutes() {
    this.router.post("/tools", async (req, res) => {
      try {
        const result = await this.vapiClient.handleToolWebhookRequest(req.body);
        res.status(200).json(result);
      } catch (error) {
        console.error("[VapiRoute] Tool webhook error", error);
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
