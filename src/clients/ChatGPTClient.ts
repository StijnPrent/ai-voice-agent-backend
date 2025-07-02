// src/clients/ChatGPTClient.ts
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat";

export class ChatGPTClient {
    private openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });

    /**
     * Haal een antwoord op bij OpenAI Chat.
     * - `opts.stream = true` retourneert een AsyncIterable waar we tokens uit lezen.
     */
    async getReply(
        userContent: string,
        opts: {
            model: string;
            max_tokens: number;
            temperature: number;
            stream?: boolean;
        }
    ): Promise<string> {
        const messages: ChatCompletionMessageParam[] = [
            {
                role: "system",
                content:
                    "Je bent een behulpzame Nederlandse spraakassistent. Antwoord in maximaal 60 woorden, direct en to the point.",
            },
            {
                role: "user",
                content: userContent,
            },
        ];

        if (opts.stream) {
            // Streaming-mode: request zonder tweede options-object
            const stream = await this.openai.chat.completions.create({
                model: opts.model,
                messages,
                max_tokens: opts.max_tokens,
                temperature: opts.temperature,
                stream: true,
            });
            return await this._consumeStream(stream);
        } else {
            // Klassieke non-stream call
            const res = await this.openai.chat.completions.create({
                model: opts.model,
                messages,
                max_tokens: opts.max_tokens,
                temperature: opts.temperature,
            });
            return res.choices?.[0].message?.content?.trim() ?? "";
        }
    }

    /**
     * Verwerkt een AsyncIterable (stream) van OpenAI en bouwt een string op.
     */
    private async _consumeStream(stream: AsyncIterable<any>): Promise<string> {
        let result = "";
        for await (const part of stream) {
            // part.choices[0].delta.content bevat de volgende token
            const delta = part.choices?.[0]?.delta?.content;
            if (delta) result += delta;
        }
        return result.trim();
    }
}
