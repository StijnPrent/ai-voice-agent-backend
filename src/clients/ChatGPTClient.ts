
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
     * Retourneert een Promise die onmiddellijk oplost.
     */
    async start(inputStream: Readable, onTextGenerated: (text: string) => void): Promise<void> {
        const messages: ChatCompletionMessageParam[] = [
            {
                role: "system",
                content:
                    "Je bent een behulpzame Nederlandse spraakassistent. Antwoord kort en direct, alsof je praat. Gebruik geen volzinnen maar spreektaal.",
            },
        ];

        let sentenceBuffer = "";

        inputStream.on("data", async (chunk) => {
            const transcript = chunk.toString();
            if (!transcript.trim()) return; // Negeer lege transcripties

            console.log(`[ChatGPT] Received transcript: ${transcript}`);
            messages.push({ role: "user", content: transcript });

            try {
                const stream = await this.openai.chat.completions.create({
                    model: "gpt-4o",
                    messages,
                    max_tokens: 150,
                    temperature: 0.7,
                    stream: true,
                });

                let fullResponse = "";
                for await (const part of stream) {
                    const delta = part.choices[0]?.delta?.content || "";
                    if (delta) {
                        fullResponse += delta;
                        sentenceBuffer += delta;

                        if (/[.?!]/.test(sentenceBuffer)) {
                            const sentence = sentenceBuffer.trim();
                            console.log(`[ChatGPT] Sending sentence: ${sentence}`);
                            onTextGenerated(sentence);
                            sentenceBuffer = "";
                        }
                    }
                }

                if (sentenceBuffer.trim()) {
                    const sentence = sentenceBuffer.trim();
                    console.log(`[ChatGPT] Sending remaining buffer: ${sentence}`);
                    onTextGenerated(sentence);
                    sentenceBuffer = "";
                }

                messages.push({ role: "assistant", content: fullResponse });
                console.log(`[ChatGPT] Full response: ${fullResponse}`);

            } catch (err) {
                console.error("[ChatGPT] Error:", err);
            }
        });

        inputStream.on("end", () => {
            console.log("[ChatGPT] Input stream ended.");
        });

        // Geef aan dat de client klaar is om te luisteren
        return Promise.resolve();
    }
}

