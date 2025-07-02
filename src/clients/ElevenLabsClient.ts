import axios from "axios";
import { Readable } from "stream";
import { injectable } from "tsyringe";

@injectable()
export class ElevenLabsClient {
    /**
     * Synthesize speech and return a readable stream (no file saved to disk).
     */
    async synthesizeSpeechStream(text: string): Promise<Readable> {
        const response = await axios.post(
            `https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVENLABS_VOICE_ID}`,
            {
                text,
                voice_settings: {
                    stability: 0.2,
                    similarity_boost: 0.2,
                    optimize_streaming_latency: true // reduce initial chunk size
                }
            },
            {
                responseType: "stream",
                headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY! }
            }
        );
        return response.data as Readable;
    }
}