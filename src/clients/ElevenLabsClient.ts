// src/clients/ElevenLabsClient.ts
import axios from "axios";
import { Readable } from "stream";
import { injectable } from "tsyringe";

@injectable()
export class ElevenLabsClient {
    async synthesizeSpeechStream(text: string): Promise<Readable> {
        const voiceId = process.env.ELEVENLABS_VOICE_ID!;
        const apiKey  = process.env.ELEVENLABS_API_KEY!;

        const response = await axios.post(
            `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
            {
                text,
                voice_settings: {
                    stability:        0.0,   // minimaal voor supersnelle chunks
                    similarity_boost: 0.0,
                },
            },
            {
                params: {
                    optimize_streaming_latency: true
                },
                responseType: "stream",
                headers: { "xi-api-key": apiKey },
            }
        );

        return response.data as Readable;
    }
}
