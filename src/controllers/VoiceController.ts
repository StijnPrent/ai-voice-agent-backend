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

        // Haal de WebSocket-URL op (wss:// voor productie)
        const websocketUrl = `wss://${req.get("host")}/ws`;

        console.log(`📞 Initiating stream to: ${websocketUrl}`);

        // Start de stream en stuur een 'mark' bericht als de AI klaar is met praten
        const connect = twiml.connect();
        connect.stream({
            url: websocketUrl,
            track: 'inbound_track'
        });
        twiml.say(' '); // Noodzakelijk om de call actief te houden
        twiml.pause({ length: 20 });


        res.type("text/xml").send(twiml.toString());
    }
}
