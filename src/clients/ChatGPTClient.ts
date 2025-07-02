import OpenAI from "openai";
import { injectable } from "tsyringe";
import config from "../config/config"; // 👈 import your central config

@injectable()
export class ChatGPTClient {
    private openai: OpenAI;

    constructor() {
        this.openai = new OpenAI({ apiKey: config.openAiKey });
    }

    async getReply(
        content: string,
        opts: { model: string; max_tokens: number; temperature: number; stream?: boolean }
    ): Promise<string> {
        const messages = [
            {
                role: "system",
                content:
                    "Je bent een behulpzame Nederlandse spraakassistent. Antwoord in maximaal 60 woorden, direct en to the point.",
            },
            { role: "user", content },
        ];

        const res = await this.openai.chat.completions.create({
            model:       opts.model,
            messages,
            max_tokens:  opts.max_tokens,
            temperature: opts.temperature,
            stream:      opts.stream ?? false,
        });

        return opts.stream
            ? await this._consumeStream(res)  // implement streaming consumer
            : res.choices[0].message.content?.trim() ?? "";
    }

}
