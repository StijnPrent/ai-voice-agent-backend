
// src/clients/ChatGPTClient.ts
import OpenAI from "openai";
import { Readable, Writable } from "stream";
import { injectable } from "tsyringe";
import type { ChatCompletionMessageParam } from "openai/resources/chat";

@injectable()
export class ChatGPTClient {
    private openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });

    /**
     * Start een streaming chat-sessie met OpenAI.
     */
    async start(inputStream: Readable, outputStream: Writable) {
        const messages: ChatCompletionMessageParam[] = [
            {
                role: "system",
                content:
                    "Je bent een behulpzame Nederlandse spraakassistent. Antwoord kort en direct, alsof je praat. Gebruik geen volzinnen maar spreektaal.",
            },
        ];

        inputStream.on("data", async (chunk) => {
            const transcript = chunk.toString();
            messages.push({ role: "user", content: transcript });

            try {
                const stream = await this.openai.chat.completions.create({
                    model: "gpt-3.5-turbo",
                    messages,
                    max_tokens: 100,
                    temperature: 0.7,
                    stream: true,
                });

                let fullResponse = "";
                for await (const part of stream) {
                    const delta = part.choices[0]?.delta?.content || "";
                    if (delta) {
                        fullResponse += delta;
                        outputStream.write(delta);
                    }
                }
                messages.push({ role: "assistant", content: fullResponse });

            } catch (err) {
                console.error("[ChatGPT] Error:", err);
            }
        });

        inputStream.on("end", () => {
            outputStream.end();
        });
    }
}

