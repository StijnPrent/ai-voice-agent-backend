// src/controllers/VoiceController.ts
import { Request, Response } from "express";
import { container } from "tsyringe";
import { VoiceService } from "../business/services/VoiceService";
import { ElevenLabsClient } from "../clients/ElevenLabsClient";
import twilio from "twilio";

export class VoiceController {
    /**
     * Eerste webhook: bij binnenkomende call speel je de welkomsgroet
     * en start je direct Twilio's speech-to-text (<Gather>).
     */
    async handleIncomingCallTwilio(req: Request, res: Response) {
        const baseUrl = process.env.SERVER_URL ?? `${req.protocol}://${req.get("host")}`;
        const twiml = new twilio.twiml.VoiceResponse();

        // 1) Begin een Gather met bargeIn en langere timeout
        const gather = twiml.gather({
            input:         ["speech"],
            action:        `${baseUrl}/voice/twilio/conversation`,
            method:        "POST",
            timeout:       5,           // 5s stilte toegestaan
            speechTimeout: "auto",
            language:      "nl-NL",
        });

        // 2) Speel binnen Gather je welkoms-MP3 en prompt
        gather.play("https://pub-9a2504ce068d4a6fa3cac4fa81a29210.r2.dev/Welkom.mp3");

        // 3) Fallback binnen dezelfde Gather: bij geen input
        twiml.redirect(`${baseUrl}/voice/twilio/incoming`);

        // 4) _Niet_ meer buiten de Gather redirect of hangup
        res.type("text/xml").send(twiml.toString());
    }

    /**
     * Tweede webhook: na <Gather> ontvangen we SpeechResult,
     * halen we een AI-antwoord op en loop je weer terug naar <Gather>.
     */
    async handleConversation(req: Request, res: Response) {
        const baseUrl = process.env.SERVER_URL ?? `${req.protocol}://${req.get("host")}`;
        const twiml = new twilio.twiml.VoiceResponse();

        try {
            const userSpeech = req.body.SpeechResult as string;

            if (!userSpeech) {
                twiml.say("Sorry, i didn't catch that. Please try again.");
            } else {
                // 1) AI-antwoord ophalen
                const voiceService = container.resolve(VoiceService);
                // let op: voeg in VoiceService een methode toe die direct met tekst werkt
                const replyText = await voiceService.getReplyFromText(userSpeech);

                // 2) Speel ElevenLabs-stem af
                twiml.play(`${baseUrl}/voice/tts?text=${encodeURIComponent(replyText)}`);
            }

            // 3) Start opnieuw een <Gather> voor de volgende vraag:
            const gather = twiml.gather({
                input:         ["speech"],
                action:        `${baseUrl}/voice/twilio/conversation`,
                method:        "POST",
                timeout:       1,
                speechTimeout: "auto",
                language:      "nl-NL",
            });

        } catch (err) {
            console.error("❌ Error in handleConversation:", err);
            twiml.say("something went wrong, please try again later.");
            twiml.hangup();
        }

        res.type("text/xml").send(twiml.toString());
    }

    /**
     * TTS-endpoint: chunked WAV-stream van ElevenLabs
     * zodat Twilio vrijwel direct kan starten met afspelen.
     */
    async tts(req: Request, res: Response) {
        const text = req.query.text as string | undefined;
        if (!text) return res.status(400).send("Missing text");

        // 1) Stel headers in
        res.setHeader("Content-Type", "audio/wav");
        res.setHeader("Transfer-Encoding", "chunked");
        res.flushHeaders?.();

        try {
            const client = container.resolve(ElevenLabsClient);
            const audioStream = await client.synthesizeSpeechStream(text);

            // 2) Pre-buffer eerste chunk (anders Twilio timeout)
            const firstChunk: Buffer = await new Promise((resolve, reject) => {
                const onData = (chunk: Buffer) => {
                    cleanup();
                    resolve(chunk);
                };
                const onError = (err: any) => {
                    cleanup();
                    reject(err);
                };
                const cleanup = () => {
                    audioStream.off("data", onData);
                    audioStream.off("error", onError);
                };
                audioStream.once("data", onData);
                audioStream.once("error", onError);
            });

            // Stuur ‘m direct door
            res.write(firstChunk);

            // 3) Dan de rest van de audio
            audioStream.pipe(res);

        } catch (err) {
            console.error("❌ Error in TTS endpoint:", err);
            if (!res.headersSent) res.status(500).send("Error generating speech");
        }
    }

}
