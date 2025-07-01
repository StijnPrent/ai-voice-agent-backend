import axios from "axios";
import fs from "fs";
import FormData from "form-data";
import { injectable } from "tsyringe";

@injectable()
export class WhisperClient {
    async transcribe(filePath: string): Promise<string> {
        const form = new FormData();
        form.append("file", fs.createReadStream(filePath));
        form.append("model", "whisper-1");

        const response = await axios.post("https://api.openai.com/v1/audio/transcriptions", form, {
            headers: {
                Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
                ...form.getHeaders(),
            },
        });
        return response.data.text;
    }
}