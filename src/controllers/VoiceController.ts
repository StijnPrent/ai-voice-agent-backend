// src/controllers/VoiceController.ts
import { Request, Response } from "express";
import twilio from "twilio";

export class VoiceController {
    /**
     * Webhook voor binnenkomende Twilio-call.
     * Start een bi-directionele media stream via een WebSocket.
     */
    async handleIncomingCallTwilio(req: Request, res: Response) {
        const twiml = new twilio.twiml.VoiceResponse();

        // Gebruik de SERVER_URL van .env en vervang http door wss
        const serverUrl = process.env.SERVER_URL!;
        const websocketUrl = serverUrl.replace(/^http/, "ws");

        const to = req.body.To;
        const websocketUrlWithParams = `${websocketUrl}/ws?to=${encodeURIComponent(to)}`;
        console.log(`📞 Initiating stream to: ${websocketUrlWithParams}`);

        // Start de stream
        const connect = twiml.connect();
        connect.stream({
            url: websocketUrlWithParams,
        });

        // Send the TwiML response
        res.type("text/xml").send(twiml.toString());
    }
}
