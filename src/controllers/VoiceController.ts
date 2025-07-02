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

        const gather = twiml.gather({
            input:         ["speech"],
            action:        `${baseUrl}/voice/twilio/conversation`,
            method:        "POST",
            timeout:       5,
            speechTimeout: "auto",
            language:      "nl-NL",
        });

        gather.play("https://pub-9a2504ce068d4a6fa3cac4fa81a29210.r2.dev/Welkom.mp3");

        // Fallback als geen spraak binnenkomt
        twiml.redirect(`${baseUrl}/voice/twilio/incoming`);

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
                twiml.say("Sorry, i couldn't understand that. Please try again.");
            } else {
                const replyText = await container
                    .resolve(VoiceService)
                    .getReplyFromText(userSpeech);

                twiml.play(`${baseUrl}/voice/tts?text=${encodeURIComponent(replyText)}`);
            }

            // Nieuwe ronde <Gather>
            const gather = twiml.gather({
                input:         ["speech"],
                action:        `${baseUrl}/voice/twilio/conversation`,
                method:        "POST",
                timeout:       5,
                speechTimeout: "auto",
                language:      "nl-NL",
            });
            gather.say("U kunt nog iets vragen.");

        } catch (err) {
            console.error("❌ Error in handleConversation:", err);
            twiml.say("We had an error processing your request. Please try again later.");
            twiml.hangup();
        }

        res.type("text/xml").send(twiml.toString());
    }

    /**
     * TTS-endpoint: chunked WAV-stream van ElevenLabs
     * met pre-buffer van de eerste chunk om Twilio timeouts te omzeilen.
     */
    async tts(req: Request, res: Response) {
        const text = (req.query.text as string | undefined) ?? "";
        if (!text) {
            return res.status(400).send("Missing `text` parameter");
        }

        // 1) Stel headers in
        res.setHeader("Content-Type", "audio/mpeg");
        res.setHeader("Transfer-Encoding", "chunked");
        res.flushHeaders?.();

        try {
            const client = container.resolve(ElevenLabsClient);
            const audioStream = await client.synthesizeSpeechStream(text);

            // 2) Pre-buffer eerste chunk
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

            // 3) Stuur direct de eerste chunk
            res.write(firstChunk);

            // 4) Pipe de rest
            audioStream.pipe(res);
        } catch (err) {
            console.error("❌ Error in TTS endpoint:", err);
            if (!res.headersSent) {
                res.status(500).send("Error generating speech");
            } else {
                res.end();
            }
        }
    }
}
