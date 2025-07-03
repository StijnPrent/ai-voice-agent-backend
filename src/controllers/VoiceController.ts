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

        console.log(`📞 Initiating stream to: ${websocketUrl}/ws`);

        // Start de stream
        const connect = twiml.connect();
        connect.stream({
            url: `${websocketUrl}/ws`,
        });

        // Een korte pauze om de stream op te zetten
        twiml.pause({ length: 20 });

        res.type("text/xml").send(twiml.toString());
    }
}
