import OpenAI from "openai";
import { injectable } from "tsyringe";
import config from "../config/config"; // 👈 import your central config

@injectable()
export class ChatGPTClient {
    private openai: OpenAI;

    constructor() {
        this.openai = new OpenAI({ apiKey: config.openAiKey });
    }

    async getReply(prompt: string): Promise<string> {
        const res = await this.openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{ role: "user", content: prompt }],
        });
        return res.choices[0].message.content || "";
    }
}
