import axios from "axios";
import FormData from "form-data";
import { injectable } from "tsyringe";

@injectable()
export class WhisperClient {
    async transcribe(fileUrl: string): Promise<string> {
        const audioStream = await axios.get(fileUrl, {
            responseType: "stream",
        });

        const formData = new FormData();
        formData.append("file", audioStream.data, {
            filename: "audio.mp3", // OpenAI requires this
            contentType: "audio/mpeg", // Or whatever it is
        });
        formData.append("model", "whisper-1");

        const response = await axios.post(
            "https://api.openai.com/v1/audio/transcriptions",
            formData,
            {
                headers: {
                    ...formData.getHeaders(),
                    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
                },
            }
        );

        return response.data.text;
    }
}