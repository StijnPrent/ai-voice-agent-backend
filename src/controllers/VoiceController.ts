import { Request, Response } from "express";
import { container } from "tsyringe";
import { VoiceService } from "../business/services/VoiceService";
import twilio from "twilio";

export class VoiceController {
    // POST /voice/twilio/conversation
    async handleConversation(req: Request, res: Response) {
        const twiml = new twilio.twiml.VoiceResponse();

        // Check of er al een opname is (dus beller sprak iets in)
        const recordingUrl = req.body.RecordingUrl;
        const from = req.body.From;
        const to = req.body.To;

        if (recordingUrl) {
            // Stap 1: transcriptie ophalen
            const voiceService = container.resolve(VoiceService);
            const transcript = await voiceService.transcribe(recordingUrl);

            // Stap 2: antwoord genereren (bijv. met GPT)
            const reply = await voiceService.generateReply(transcript, from);

            // Stap 3: antwoord terugzeggen
            twiml.say(reply);
        } else {
            // Eerste keer? Dan even een welkomstzin
            twiml.say("Hallo, u spreekt met onze assistent. Wat kan ik voor u doen?");
        }

        // Stap 4: opname starten voor volgende input
        twiml.record({
            action: "/voice/twilio/conversation",
            method: "POST",
            maxLength: 10,
            playBeep: true,
            trim: "do-not-trim",
            timeout: 3, // wacht max 3 seconden op stem
        });

        res.type("text/xml").send(twiml.toString());
    }


    async handleIncomingCallTwilio(req: Request, res: Response) {
        const twiml = new twilio.twiml.VoiceResponse();
        twiml.say("Hallo! Je Twilio webhook werkt.");
        res.type("text/xml").send(twiml.toString());
    }
}