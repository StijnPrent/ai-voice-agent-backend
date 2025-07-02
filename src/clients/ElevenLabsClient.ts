import axios from "axios";
import { Readable } from "stream";
import { injectable } from "tsyringe";

@injectable()
export class ElevenLabsClient {
    /**
     * Gewone ElevenLabs HTTP-endpoint; levert een MP3-stream.
     */
    async synthesizeSpeechStream(text: string): Promise<Readable> {
        const voiceId = process.env.ELEVENLABS_VOICE_ID!;
        const apiKey  = process.env.ELEVENLABS_API_KEY!;

        const response = await axios.post(
            `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
            {
                text,
                voice_settings: {
                    stability:               0.2,   // verlaag gerust naar 0.1 of 0.0 voor iets snellere chunks
                    similarity_boost:        0.2,
                    optimize_streaming_latency: true // eerste chunks sneller
                }
            },
            {
                responseType: "stream",
                headers:      { "xi-api-key": apiKey },
            }
        );

        return response.data as Readable;
    }
}
