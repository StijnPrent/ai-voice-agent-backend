import { Router } from "express";
import { inject, injectable } from "tsyringe";
import { VapiClient } from "../clients/VapiClient";
import { workerIdentity } from "../config/workerIdentity";

@injectable()
export class InternalVapiRoute {
  private readonly router: Router;
  private readonly expectedToken = workerIdentity.proxyToken;

  constructor(@inject(VapiClient) private readonly vapiClient: VapiClient) {
    this.router = Router();
    this.registerRoutes();
  }

  public getRouter(): Router {
    return this.router;
  }

  private registerRoutes() {
    this.router.post("/tools", async (req, res) => {
      if (!this.isAuthorized(req.headers)) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      try {
        const result = await this.vapiClient.handleToolWebhookRequest(req.body);
        res.status(200).json(result);
      } catch (error) {
        console.error("[InternalVapiRoute] Tool webhook proxy error", error);
        res.status(500).json({ error: "Internal Vapi tool handler error" });
      }
    });
  }

  private isAuthorized(headers: Record<string, unknown>): boolean {
    if (!this.expectedToken) {
      return true;
    }

    const headerValue = headers["x-internal-tool-proxy-token"];
    if (typeof headerValue === "string") {
      return headerValue === this.expectedToken;
    }

    if (Array.isArray(headerValue)) {
      return headerValue.includes(this.expectedToken);
    }

    return false;
  }
}

export default InternalVapiRoute;
