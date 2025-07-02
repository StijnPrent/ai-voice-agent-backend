// src/clients/ElevenLabsClient.ts
import axios from "axios";
import { Readable } from "stream";
import { injectable } from "tsyringe";

@injectable()
export class ElevenLabsClient {
    // src/clients/ElevenLabsClient.ts
    async synthesizeSpeechStream(text: string): Promise<Readable> {
        const resp = await axios.post(
            `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
            { text, voice_settings: { stability:0.0, similarity_boost:0.0 } },
            { params: { optimize_streaming_latency: true }, responseType: "stream", headers }
        );
        return resp.data;
    }
}
