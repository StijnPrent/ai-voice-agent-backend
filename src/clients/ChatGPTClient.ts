// src/clients/ChatGPTClient.ts
import OpenAI from "openai";
import { Readable } from "stream";
import { inject, injectable } from "tsyringe";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat";
import { CompanyModel } from "../business/models/CompanyModel";
import { GoogleCalendarClient } from "./GoogleCalendarClient";

@injectable()
export class ChatGPTClient {
    private openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });
    private company: CompanyModel | null = null;
    private hasGoogleIntegration = false;

    constructor(
        @inject(GoogleCalendarClient) private googleCalendarClient: GoogleCalendarClient
    ) {}

    public setCompanyInfo(company: CompanyModel, hasGoogleIntegration: boolean) {
        this.company = company;
        this.hasGoogleIntegration = hasGoogleIntegration;
    }

    async start(inputStream: Readable, onTextGenerated: (text: string) => void): Promise<void> {
        const messages: ChatCompletionMessageParam[] = [
            {
                role: "system",
                content: this.getSystemPrompt(),
            },
        ];

        inputStream.on("data", async (chunk) => {
            const transcript = chunk.toString();
            if (!transcript.trim()) return;

            console.log(`[ChatGPT] Received transcript: ${transcript}`);
            messages.push({ role: "user", content: transcript });

            try {
                const response = await this.openai.chat.completions.create({
                    model: "gpt-4o",
                    messages,
                    max_tokens: 150,
                    temperature: 0.7,
                    tools: this.getTools(),
                    tool_choice: "auto",
                });

                const responseMessage = response.choices[0].message;

                if (responseMessage.tool_calls) {
                    messages.push(responseMessage);
                    for (const toolCall of responseMessage.tool_calls) {
                        const functionName = toolCall.function.name;
                        const functionArgs = JSON.parse(toolCall.function.arguments);

                        if (functionName === 'create_calendar_event') {
                            console.log(`[ChatGPT] Tool call: create_calendar_event with args:`, functionArgs);
                            const { summary, location, description, start, end } = functionArgs;
                            const event = { summary, location, description, start: { dateTime: start }, end: { dateTime: end } };
                            
                            await this.googleCalendarClient.createEvent(this.company!.id, event);
                            
                            const confirmation = `Oké, de afspraak voor '${summary}' is ingepland. Kan ik nog iets anders voor je doen?`;
                            onTextGenerated(confirmation);
                            
                            messages.push({
                                tool_call_id: toolCall.id,
                                role: "tool",
                                name: functionName,
                                content: JSON.stringify({ success: true, event_summary: summary }),
                            });
                        }
                    }
                } else {
                    const fullResponse = responseMessage.content || "";
                    if (fullResponse) {
                        onTextGenerated(fullResponse);
                    }
                    messages.push({ role: "assistant", content: fullResponse });
                }

            } catch (err) {
                console.error("[ChatGPT] Error:", err);
                onTextGenerated("Sorry, er is iets misgegaan. Kunt u dat herhalen?");
            }
        });

        inputStream.on("end", () => {
            console.log("[ChatGPT] Input stream ended.");
        });

        return Promise.resolve();
    }

    private getSystemPrompt(): string {
        let prompt = "Je bent een behulpzame Nederlandse spraakassistent voor het bedrijf '{this.company?.name}'. Antwoord kort en direct, alsof je praat. Gebruik geen volzinnen maar spreektaal.";
        if (this.hasGoogleIntegration) {
            prompt += " Je hebt de mogelijkheid om afspraken in de Google Agenda van het bedrijf te plannen. Vraag altijd om een expliciete bevestiging van de gebruiker voordat je een afspraak definitief inplant.";
        }
        return prompt;
    }

    private getTools(): ChatCompletionTool[] {
        if (!this.hasGoogleIntegration) {
            return [];
        }
        return [
            {
                type: "function",
                function: {
                    name: "create_calendar_event",
                    description: "Maak een nieuw evenement aan in de Google Agenda van het bedrijf. Vraag altijd om de datum en tijd.",
                    parameters: {
                        type: "object",
                        properties: {
                            summary: { type: "string", description: "De titel van de afspraak" },
                            location: { type: "string", description: "De locatie van de afspraak" },
                            description: { type: "string", description: "Een beschrijving van de afspraak" },
                            start: { type: "string", description: "De starttijd van de afspraak in ISO 8601 formaat (e.g., 2025-07-21T10:00:00)" },
                            end: { type: "string", description: "De eindtijd van de afspraak in ISO 8601 formaat (e.g., 2025-07-21T11:00:00)" },
                        },
                        required: ["summary", "start", "end"],
                    },
                },
            },
        ];
    }
}
