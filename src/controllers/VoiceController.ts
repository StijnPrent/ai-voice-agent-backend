import { Request, Response } from "express";
import { container } from "tsyringe";
import { VoiceService } from "../business/services/VoiceService";
import twilio from "twilio";

export class VoiceController {
    // POST /voice/twilio/conversation
    async handleConversation(req: Request, res: Response) {
        try {
            const twiml = new twilio.twiml.VoiceResponse();

            const recordingUrl = req.body.RecordingUrl;
            const from = req.body.From;
            const to = req.body.To;

            const voiceService = container.resolve(VoiceService);

            if (recordingUrl) {
                // Stap 1: transcriptie ophalen
                const transcript = await voiceService.transcribe(recordingUrl);

                // Stap 2: antwoord genereren
                const reply = await voiceService.generateReply(transcript, from);

                // 🔊 Stap 3: audio genereren met ElevenLabs
                const audioUrl = await voiceService.synthesizeReply(reply, from); // retourneert een publieke URL

                // 🎧 Stap 4: afspelen in plaats van say()
                twiml.play(audioUrl);
            } else {
                // Eerste keer? Gebruik eventueel een standaard ElevenLabs-audio
                twiml.play("https://api.voiceagent.stite.nl/audio/welcome.mp3");

                // Of fallback naar TTS
                // twiml.say("Hallo, u spreekt met onze assistent. Wat kan ik voor u doen?");
            }

            // Stap 5: opnieuw opnemen
            twiml.record({
                action: "/voice/twilio/conversation",
                method: "POST",
                maxLength: 10,
                playBeep: false,
                trim: "do-not-trim",
                timeout: 3,
            });

            res.type("text/xml").send(twiml.toString());
        } catch (err) {
            console.error("❌ Error in TwilioVoiceController:", err);
            res.status(500).type("text/xml").send("<Response><Say>Er ging iets mis.</Say></Response>");
        }
    }



    async handleIncomingCallTwilio(req: Request, res: Response) {
        const twiml = new twilio.twiml.VoiceResponse();
        twiml.say("Hallo! Je Twilio webhook werkt.");
        res.type("text/xml").send(twiml.toString());
    }
}