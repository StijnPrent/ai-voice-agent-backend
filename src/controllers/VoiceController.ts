// src/controllers/VoiceController.ts
import { Request, Response } from "express";
import twilio from "twilio";
import { container } from "tsyringe";
import { VoiceService } from "../business/services/VoiceService";

export class VoiceController {
    /**
     * Webhook voor binnenkomende Twilio-call.
     * Start een bi-directionele media stream via een WebSocket.
     */
    async handleIncomingCallTwilio(req: Request, res: Response): Promise<void> {
        const twiml = new twilio.twiml.VoiceResponse();

        // Gebruik de SERVER_URL van .env en vervang http door wss
        const serverUrl = process.env.SERVER_URL!;
        const websocketUrl = serverUrl.replace(/^http/, "ws");

        const to = req.body.To;
        const from = req.body.From;
        const params = new URLSearchParams();
        if (typeof to === "string" && to.length > 0) {
            params.set("to", to);
        }
        if (typeof from === "string" && from.length > 0) {
            params.set("from", from);
        }
        const websocketUrlWithParams = `${websocketUrl}/ws?${params.toString()}`;
        console.log(`📞 Initiating stream to: ${websocketUrlWithParams}`);

        // Start de stream
        const connect = twiml.connect();
        connect.stream({
            url: websocketUrlWithParams,
        });

        // Send the TwiML response
        res.type("text/xml").send(twiml.toString());
    }

    async transferActiveCall(req: Request, res: Response) {
        const { callSid, phoneNumber, callerId, reason } = req.body as {
            callSid?: string;
            phoneNumber?: string;
            callerId?: string;
            reason?: string;
        };

        if (!phoneNumber || typeof phoneNumber !== "string") {
            res.status(400).json({ error: "phoneNumber is verplicht" });
            return;
        }

        try {
            const voiceService = container.resolve(VoiceService);
            await voiceService.transferCall(phoneNumber, {
                callSid,
                callerId,
                reason,
            });
            res.json({ success: true });
        } catch (error) {
            console.error("❌ transferActiveCall failed:", error);
            const message = error instanceof Error ? error.message : "Onbekende fout";
            res.status(500).json({ error: message });
        }
    }
}
