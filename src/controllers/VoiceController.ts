import { Request, Response } from "express";
import { container } from "tsyringe";
import { VoiceService } from "../business/services/VoiceService";
import twilio from "twilio";

export class VoiceController {
    async handleIncomingCall(req: Request, res: Response) {
        if (!req.body.From) {
            return res.status(400).send("Missing From parameter");
        }
        try {
            const from = req.body.From;
            const to = req.body.To;
            const recordingUrl = req.body.RecordingUrl;

            if (!recordingUrl) {
                // Step 1: Tell Twilio to record the call
                const twiml = new twilio.twiml.VoiceResponse();
                twiml.say("U wordt doorverbonden met onze assistent.");
                twiml.record({
                    action: "/api/twilio/callback", // will receive recordingUrl here
                    method: "POST",
                    maxLength: 30,
                    playBeep: true,
                    trim: "do-not-trim",
                });
                res.type("text/xml").send(twiml.toString());
                return;
            }

            // Step 2: Process the recording
            const voiceService = container.resolve(VoiceService);
            await voiceService.processCall(from, to, recordingUrl);
            res.sendStatus(200);
        } catch (err) {
            console.error("❌ Error in TwilioVoiceController:", err);
            res.status(500).send("Internal server error");
        }
    }

    async handleLocalTest(req: Request, res: Response) {
        const service = container.resolve(VoiceService);
        try {
            await service.processCallTest();
            res.status(200).send("✅ Local test completed, check audio/output.mp3");
        } catch (e) {
            console.error("❌ Local test failed:", e);
            res.status(500).send("Error in local test");
        }
    }
}