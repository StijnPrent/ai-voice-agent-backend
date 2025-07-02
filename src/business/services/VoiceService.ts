import { injectable, inject } from "tsyringe";
import axios from "axios";
import FormData from "form-data";
import { OpenAI } from "openai";

@injectable()
export class VoiceService {
    private openai: OpenAI;

    constructor() {
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });
    }

    /**
     * Transcribe audio file from a Twilio recording URL (requires auth)
     */
    async transcribe(recordingUrl: string): Promise<string> {
        const mp3Url = recordingUrl.endsWith(".mp3") ? recordingUrl : `${recordingUrl}.mp3`;

        // ✅ Twilio basic auth
        const audioRes = await axios.get(mp3Url, {
            responseType: "arraybuffer", // Whisper expects buffer
            auth: {
                username: process.env.TWILIO_SID!,
                password: process.env.TWILIO_AUTH!,
            },
        });

        const formData = new FormData();
        formData.append("file", Buffer.from(audioRes.data), {
            filename: "audio.mp3",
            contentType: "audio/mpeg",
        });
        formData.append("model", "whisper-1");

        const response = await axios.post("https://api.openai.com/v1/audio/transcriptions", formData, {
            headers: {
                ...formData.getHeaders(),
                Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            },
        });

        return response.data.text;
    }

    /**
     * Generate an AI reply to the user's spoken input
     */
    async generateReply(transcript: string, fromNumber: string): Promise<string> {
        const result = await this.openai.chat.completions.create({
            model: "gpt-4",
            messages: [
                {
                    role: "system",
                    content: "Je bent een telefonische klantenservice-assistent voor een Nederlands bedrijf.",
                },
                {
                    role: "user",
                    content: transcript,
                },
            ],
        });

        const reply = result.choices[0]?.message?.content?.trim() || "Ik heb u niet goed verstaan.";

        return reply;
    }
}
