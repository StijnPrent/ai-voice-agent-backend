// src/business/services/VoiceService.ts
import { inject, injectable } from "tsyringe";
import { WhisperClient } from "../../clients/WhisperClient";
import { ChatGPTClient } from "../../clients/ChatGPTClient";
import { ElevenLabsClient } from "../../clients/ElevenLabsClient";

@injectable()
export class VoiceService {
    constructor(
        @inject(WhisperClient) private whisperClient: WhisperClient,
        @inject(ChatGPTClient) private chatGptClient: ChatGPTClient,
        @inject(ElevenLabsClient) private elevenLabsClient: ElevenLabsClient
    ) {}

    /**
     * Audio-URL → transcriptie → AI-antwoord.
     * Nog gebruikmakend van Whisper, maar met gpt-3.5-turbo én korte tokens voor snelheid.
     */
    async processConversation(recordingUrl: string): Promise<string> {

        // 2) Transcribe (dit is de langzamere stap, maar we houden ‘m voor fallback)
        const transcript = await this.whisperClient.transcribe(recordingUrl);

        // 3) Haal AI-antwoord op met gpt-3.5-turbo en max_tokens limiet
        const reply = await this.chatGptClient.getReply(transcript, {
            model:       "gpt-3.5-turbo",
            max_tokens:  80,
            temperature: 0.7,
            // stream:   true, // optioneel: voor nog ~200ms winst met streaming
        });

        return reply.trim();
    }

    /**
     * Direct tekst → AI-antwoord (voor Twilio <Gather>-flow).
     * Slaat Whisper over en is daardoor veel sneller.
     */
    async getReplyFromText(userText: string): Promise<string> {
        const reply = await this.chatGptClient.getReply(userText, {
            model:       "gpt-3.5-turbo",
            max_tokens:  80,
            temperature: 0.7,
            // stream:   true, // optioneel
        });

        return reply.trim();
    }
}
