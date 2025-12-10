import { Response } from "express";
import { container } from "tsyringe";
import { AuthenticatedRequest } from "../middleware/auth";
import { WhatsappIntegrationService } from "../business/services/WhatsappIntegrationService";
import { WhatsappChatService } from "../business/services/WhatsappChatService";

export class WhatsappController {
    private get integrationService(): WhatsappIntegrationService {
        return container.resolve(WhatsappIntegrationService);
    }

    private get chatService(): WhatsappChatService {
        return container.resolve(WhatsappChatService);
    }

    public verifyWebhook(req: AuthenticatedRequest, res: Response) {
        const mode = req.query["hub.mode"];
        const token = req.query["hub.verify_token"];
        const challenge = req.query["hub.challenge"];

        if (mode === "subscribe" && typeof token === "string" && this.integrationService.isValidVerifyToken(token)) {
            res.status(200).send(challenge);
            return;
        }

        res.status(403).send("forbidden");
    }

    public async receiveWebhook(req: AuthenticatedRequest, res: Response) {
        try {
            const messages = this.chatService.parseMessages(req.body);
            await Promise.all(messages.map((msg) => this.chatService.handleIncoming(msg)));
            res.status(200).json({ received: messages.length });
        } catch (error) {
            console.error("[WhatsappController] webhook error", error);
            res.status(500).json({ message: "Failed to process webhook" });
        }
    }

    public async upsertIntegration(req: AuthenticatedRequest, res: Response) {
        try {
            if (!req.companyId) {
                res.status(401).json({ message: "Missing company context" });
                return;
            }

            const { businessAccountId, phoneNumberId, accessToken, verifyToken } = req.body ?? {};

            if (!businessAccountId || !phoneNumberId || !accessToken) {
                res.status(400).json({ message: "businessAccountId, phoneNumberId and accessToken are required." });
                return;
            }

            await this.integrationService.upsertIntegration({
                companyId: req.companyId,
                businessAccountId: String(businessAccountId),
                phoneNumberId: String(phoneNumberId),
                accessToken: String(accessToken),
                verifyToken: typeof verifyToken === "string" ? verifyToken : undefined,
            });

            res.status(200).json({ success: true });
        } catch (error) {
            console.error("[WhatsappController] upsertIntegration error", error);
            res.status(500).json({ message: "Failed to save WhatsApp integration" });
        }
    }

    public async getIntegration(req: AuthenticatedRequest, res: Response) {
        try {
            if (!req.companyId) {
                res.status(401).json({ message: "Missing company context" });
                return;
            }

            const integration = await this.integrationService.getByCompanyId(req.companyId);
            if (!integration) {
                res.status(404).json({ message: "No WhatsApp integration found" });
                return;
            }

            res.json({
                businessAccountId: integration.businessAccountId,
                phoneNumberId: integration.phoneNumberId,
                status: integration.status,
                verifyTokenConfigured: Boolean(integration.verifyToken || process.env.WHATSAPP_VERIFY_TOKEN),
            });
        } catch (error) {
            console.error("[WhatsappController] getIntegration error", error);
            res.status(500).json({ message: "Failed to fetch WhatsApp integration" });
        }
    }
}
