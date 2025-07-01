import axios from "axios";
import fs from "fs";
import { injectable } from "tsyringe";

@injectable()
export class ElevenLabsClient {
    async synthesizeSpeech(text: string, outputFile: string): Promise<void> {
        const response = await axios.post(
            `https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVENLABS_VOICE_ID}`,
            { text, voice_settings: { stability: 0.5, similarity_boost: 0.5 } },
            {
                responseType: "stream",
                headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY },
            }
        );
        const writer = fs.createWriteStream(outputFile);
        response.data.pipe(writer);
        return new Promise((res) => writer.on("finish", res));
    }
}