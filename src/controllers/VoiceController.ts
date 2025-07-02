// === controllers/VoiceController.ts ===
import { Request, Response } from "express";
import { container } from "tsyringe";
import { VoiceService } from "../business/services/VoiceService";
import { ElevenLabsClient } from "../clients/ElevenLabsClient";
import twilio from "twilio";

export class VoiceController {
    /**
     * Handles Twilio webhook after recording user input.
     */
    async handleConversation(req: Request, res: Response) {
        const twiml = new twilio.twiml.VoiceResponse();
        try {
            const { RecordingUrl } = req.body;
            if (!RecordingUrl) {
                twiml.play("https://pub-9a2504ce068d4a6fa3cac4fa81a29210.r2.dev/Welkom.mp3");
            } else {
                const replyText = await container.resolve(VoiceService).processConversation(RecordingUrl);

                // SevenLabs-stem: chunked streaming
                twiml.play(`${process.env.SERVER_URL}/voice/tts?text=${encodeURIComponent(replyText)}`);
            }
            twiml.record({
                action: `${process.env.SERVER_URL}/voice/twilio/conversation`,
                method: "POST",
                maxLength: 30,
                playBeep: false,
            });
            twiml.hangup();
        } catch (err) {
            console.error(err);
            twiml.say("Er is iets misgegaan. Probeer het later opnieuw.");
            twiml.hangup();
        }
        res.type("text/xml").send(twiml.toString());
    }

    /**
     * Streams TTS audio for Twilio to play (no disk storage).
     */
    async tts(req: Request, res: Response) {
        try {
            const text = req.query.text as string;
            const elevenLabsClient = container.resolve(ElevenLabsClient);

            // Chunked transfer zodat Twilio meteen kan starten met afspelen
            res.setHeader("Content-Type", "audio/mpeg");
            res.setHeader("Transfer-Encoding", "chunked");
            res.flushHeaders?.();

            const audioStream = await elevenLabsClient.synthesizeSpeechStream(text);
            audioStream.pipe(res);
        } catch (err) {
            console.error(err);
            res.status(500).send("Error generating speech");
        }
    }
}