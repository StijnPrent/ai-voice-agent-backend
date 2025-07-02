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
            const voiceService = container.resolve(VoiceService);
            const replyText = await voiceService.processConversation(RecordingUrl);
            // Play generated speech via our TTS endpoint
            const ttsUrl = `${process.env.BASE_URL}/voice/tts?text=${encodeURIComponent(replyText)}`;
            twiml.play(ttsUrl);
            // Optionally continue recording for follow-up (loop)
            twiml.record({
                action: `${process.env.BASE_URL}/voice/twilio/conversation`,
                method: "POST",
                maxLength: 30,
                playBeep: true,
            });
            twiml.hangup();
        } catch (err) {
            console.error("❌ Error in handleConversation:", err);
            twiml.say("Er is iets misgegaan. Probeer het later opnieuw.");
            twiml.hangup();
        }
        res.type("text/xml").send(twiml.toString());
    }

    /**
     * Answers new calls by recording user after a prompt.
     */
    async handleIncomingCallTwilio(req: Request, res: Response) {
        const twiml = new twilio.twiml.VoiceResponse();
        twiml.say("Hallo! U wordt verbonden met onze spraakassistent. Spreek na de piep.");
        twiml.record({
            action: `${process.env.BASE_URL}/voice/twilio/conversation`,
            method: "POST",
            maxLength: 30,
            playBeep: true,
        });
        twiml.hangup();
        res.type("text/xml").send(twiml.toString());
    }

    /**
     * Streams TTS audio for Twilio to play (no disk storage).
     */
    async tts(req: Request, res: Response) {
        try {
            const text = req.query.text as string;
            const elevenLabsClient = container.resolve(ElevenLabsClient);
            const audioStream = await elevenLabsClient.synthesizeSpeechStream(text);
            res.setHeader("Content-Type", "audio/mpeg");
            audioStream.pipe(res);
        } catch (err) {
            console.error("❌ Error in TTS endpoint:", err);
            res.status(500).send("Error generating speech");
        }
    }
}