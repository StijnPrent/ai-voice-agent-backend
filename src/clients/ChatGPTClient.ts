// src/clients/ChatGPTClient.ts
import OpenAI from "openai";
import {Readable} from "stream";
import {inject, injectable} from "tsyringe";
import type {ChatCompletionMessageParam, ChatCompletionTool} from "openai/resources/chat";
import {CompanyModel} from "../business/models/CompanyModel";
import {GoogleService} from "../business/services/GoogleService";
import {ReplyStyleModel} from "../business/models/ReplyStyleModel";
import {CompanyInfoModel} from "../business/models/CompanyInfoModel";

import {CompanyDetailsModel} from "../business/models/CompanyDetailsModel";
import {CompanyHourModel} from "../business/models/CompanyHourModel";
import {CompanyContactModel} from "../business/models/CompanyContactModel";

type CompanyContext = {
    details: CompanyDetailsModel | null;
    contact: CompanyContactModel | null;
    hours: CompanyHourModel[];
    info: CompanyInfoModel[];
};

@injectable()
export class ChatGPTClient {
    private openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });
    private company: CompanyModel | null = null;
    private hasGoogleIntegration = false;
    private replyStyle: ReplyStyleModel | null = null;
    private companyContext: CompanyContext | null = null;
    private messages: ChatCompletionMessageParam[] = [];

    constructor(
        @inject(GoogleService) private googleService: GoogleService
    ) {
    }

    public setCompanyInfo(
        company: CompanyModel,
        hasGoogleIntegration: boolean,
        replyStyle: ReplyStyleModel,
        context: CompanyContext
    ) {
        this.company = company;
        this.hasGoogleIntegration = hasGoogleIntegration;
        this.replyStyle = replyStyle;
        this.companyContext = context;
        // Initialize the conversation history with the system prompt
        this.messages = [
            {
                role: "system",
                content: this.getSystemPrompt(),
            },
        ];
    }

    public clearHistory() {
        this.messages = [];
    }

    async start(inputStream: Readable, onTextGenerated: (text: string) => void): Promise<void> {
        inputStream.on("data", async (chunk) => {
            const transcript = chunk.toString();
            if (!transcript.trim()) return;

            console.log(`[ChatGPT] Received transcript: ${transcript}`);
            this.messages.push({role: "user", content: transcript});

            try {
                const response = await this.openai.chat.completions.create({
                    model: "gpt-5-mini",
                    messages: this.messages,
                    max_tokens: 150,
                    temperature: 0.7,
                    tools: this.getTools(),
                    tool_choice: "auto",
                });

                const responseMessage = response.choices[0].message;

                if (responseMessage.tool_calls) {
                    this.messages.push(responseMessage);
                    for (const toolCall of responseMessage.tool_calls) {
                        const functionName = toolCall.function.name;
                        const functionArgs = JSON.parse(toolCall.function.arguments);

                        if (functionName === 'create_calendar_event') {
                            console.log(`[ChatGPT] Tool call: create_calendar_event with args:`, functionArgs);
                            const {summary, location, description, start, end} = functionArgs;
                            const event = {
                                summary,
                                location,
                                description,
                                start: {dateTime: start, timeZone: 'Europe/Amsterdam'},
                                end: {dateTime: end, timeZone: 'Europe/Amsterdam'}
                            };

                            await this.googleService.scheduleEvent(this.company!.id, event);

                            const confirmation = `Oké, de afspraak voor '${summary}' is ingepland. Kan ik nog iets anders voor je doen?`;
                            onTextGenerated(confirmation);

                            this.messages.push({
                                tool_call_id: toolCall.id,
                                role: "tool",
                                content: JSON.stringify({success: true, event_summary: summary}),
                            });
                        }
                    }
                } else {
                    const fullResponse = responseMessage.content || "";
                    if (fullResponse) {
                        onTextGenerated(fullResponse);
                    }
                    this.messages.push({role: "assistant", content: fullResponse});
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
        if (!this.company || !this.replyStyle || !this.companyContext) {
            throw new Error("Company info, reply style, and context must be set before generating a system prompt.");
        }

        const {details, contact, hours, info} = this.companyContext;

        let prompt = `Je bent een behulpzame Nederlandse spraakassistent voor het bedrijf '${this.company.name}'. ${this.replyStyle.description}\n\n`;
        prompt += `
        PRAATSTIJL:
        - Klink menselijk en ontspannen. Gebruik af en toe korte fillers zoals "hmm", "even kijken", "goed om te weten" (spaarzaam).
        - Gebruik korte zinnen, wissel ritme, vermijd lange opsommingen.
        - Markeer pauzes met [[pause:300]] of [[pause:600]] (max 1–2 per alinea).
        - Geen overdaad aan toneelbeschrijvingen; houd het subtiel.\n
        `;


        prompt += "Hier is wat informatie over het bedrijf:\n";

        if (details) {
            prompt += `\n**Bedrijfsdetails:**\n`;
            prompt += `- Naam: ${details.name}\n`;
            if (details.industry) prompt += `- Industrie: ${details.industry}\n`;
            if (details.description) prompt += `- Omschrijving: ${details.description}\n`;
        }

        if (contact) {
            prompt += `\n**Contactinformatie:**\n`;
            if (contact.website) prompt += `- Website: ${contact.website}\n`;
            if (contact.phone) prompt += `- Telefoonnummer: ${contact.phone}\n`;
            if (contact.address) prompt += `- Adres: ${contact.address}\n`;
        }

        if (hours && hours.length > 0) {
            prompt += `\n**Openingstijden:**\n`;
            const days = ["Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrijdag", "Zaterdag", "Zondag"];
            hours.forEach(hour => {
                const day = days[hour.dayOfWeek - 1];
                if (hour.isOpen) {
                    prompt += `- ${day}: ${hour.openTime} - ${hour.closeTime}\n`;
                } else {
                    prompt += `- ${day}: Gesloten\n`;
                }
            });
        }

        if (info && info.length > 0) {
            prompt += "\n**Algemene Informatie:**\n";
            info.forEach(i => {
                prompt += `- ${i.value}\n`;
            });
        }

        prompt += "\n";

        if (this.hasGoogleIntegration) {
            prompt += "BELANGRIJKE INSTRUCTIE: Je hebt toegang tot de Google Agenda van het bedrijf. Gebruik ALTIJD de 'create_calendar_event' tool om afspraken in te plannen wanneer een gebruiker hierom vraagt. Vraag altijd om de benodigde informatie zoals datum en tijd, en vraag om een expliciete bevestiging voordat je de afspraak definitief inplant.";
        } else {
            prompt += "BELANGRIJKE INSTRUCTIE: Je hebt GEEN toegang tot de agenda. Als een gebruiker een afspraak wil maken, informeer hen dan dat je dit niet automatisch kunt doen. Bied aan om een notitie achter te laten voor het team of om de gebruiker door te verbinden met een medewerker.";
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
                            summary: {type: "string", description: "De titel van de afspraak"},
                            location: {type: "string", description: "De locatie van de afspraak"},
                            description: {type: "string", description: "Een beschrijving van de afspraak"},
                            start: {
                                type: "string",
                                description: "De starttijd van de afspraak in ISO 8601 formaat (e.g., 2025-07-21T10:00:00)"
                            },
                            end: {
                                type: "string",
                                description: "De eindtijd van de afspraak in ISO 8601 formaat (e.g., 2025-07-21T11:00:00)"
                            },
                        },
                        required: ["summary", "start", "end"],
                    },
                },
            },
        ];
    }
}
