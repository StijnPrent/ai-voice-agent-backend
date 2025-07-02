import OpenAI, { ChatCompletionRequestMessage } from "openai";

export class ChatGPTClient {
    private openai = new OpenAI();

    /**
     * Haal een reply op bij OpenAI.
     * - `opts.stream = true` gebruikt streaming en pipes de tokens via _consumeStream.
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
        const messages: ChatCompletionRequestMessage[] = [
            {
                role:    "system",
                content:
                    "Je bent een behulpzame Nederlandse spraakassistent. Antwoord in maximaal 60 woorden, direct en to the point.",
            },
            {
                role:    "user",
                content: userContent,
            },
        ];

        if (opts.stream) {
            // streaming-mode: begin direct met tokens ontvangen
            const stream = await this.openai.chat.completions.create(
                {
                    model:       opts.model,
                    messages,
                    max_tokens:  opts.max_tokens,
                    temperature: opts.temperature,
                    stream:      true,
                },
                { responseType: "stream" }
            );
            return await this._consumeStream(stream);
        } else {
            // klassieke non-stream call
            const res = await this.openai.chat.completions.create({
                model:       opts.model,
                messages,
                max_tokens:  opts.max_tokens,
                temperature: opts.temperature,
            });
            return res.choices?.[0].message?.content?.trim() ?? "";
        }
    }

    /**
     * Verwerkt een AsyncIterable stream van OpenAI en bouwt een string op.
     */
    private async _consumeStream(
        stream: AsyncIterable<{
            choices: { delta?: { content?: string } }[];
        }>
    ): Promise<string> {
        let result = "";
        for await (const part of stream) {
            const delta = part.choices?.[0]?.delta?.content;
            if (delta) result += delta;
        }
        return result.trim();
    }
}
