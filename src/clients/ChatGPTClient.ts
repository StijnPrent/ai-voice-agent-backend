// src/clients/ChatGPTClient.ts
import OpenAI from "openai";
import { Readable } from "stream";
import { inject, injectable } from "tsyringe";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat";
import { CompanyModel } from "../business/models/CompanyModel";
import { GoogleService } from "../business/services/GoogleService";
import { ReplyStyleModel } from "../business/models/ReplyStyleModel";
import { CompanyInfoModel } from "../business/models/CompanyInfoModel";
import { CompanyDetailsModel } from "../business/models/CompanyDetailsModel";
import { CompanyHourModel } from "../business/models/CompanyHourModel";
import { CompanyContactModel } from "../business/models/CompanyContactModel";
import { summarizeSlots } from "../utils/tts/SummerizeSlots";

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

    constructor(@inject(GoogleService) private googleService: GoogleService) {}

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

    private trimHistory() {
        // keep system + last 4 turns to reduce latency
        if (this.messages.length <= 10) return;
        const sys = this.messages[0];
        const rest = this.messages.slice(1);
        const MAX_TURNS = 4;
        this.messages = [sys, ...rest.slice(-MAX_TURNS * 2)];
    }

    async start(inputStream: Readable, onTextGenerated: (text: string) => void): Promise<void> {
        inputStream.on("data", async (chunk) => {
            const transcript = chunk.toString();
            if (!transcript.trim()) return;

            console.log(`[ChatGPT] Received transcript: ${transcript}`);
            this.messages.push({ role: "user", content: transcript });
            this.trimHistory(); // keep convo small for latency

            try {
                // ---- Gate tools behind a lightweight intent check ----
                // Only include tools when the user likely wants calendar actions
                const intentRegex = /\b(afspraak|plannen|reserveren|inplannen|agenda|kalender|verzetten|annuleren|afzeggen)\b/i;
                const useTools = this.hasGoogleIntegration && intentRegex.test(transcript);

                // IMPORTANT: stream tokens
                const stream = await this.openai.chat.completions.create({
                    model: "gpt-4o-mini",
                    messages: this.messages,
                    temperature: 0.6, // a tad lower: faster, more decisive answers
                    stream: true,
                    ...(useTools ? { tools: this.getTools(), tool_choice: "auto" } : {}),
                });

                let fullText = "";
                let toolCallsBuffer: any[] = []; // collect streamed tool call deltas
                let sawToolCalls = false;

                for await (const chunk of stream) {
                    const choice = chunk.choices?.[0];

                    // 1) Stream normal text deltas ASAP
                    const deltaText = choice?.delta?.content;
                    if (deltaText) {
                        fullText += deltaText;
                        onTextGenerated(deltaText); // low-latency: speak as it arrives
                    }

                    // 2) Collect streamed tool calls, if any
                    const deltaTools = choice?.delta?.tool_calls;
                    if (deltaTools && deltaTools.length > 0) {
                        sawToolCalls = true;
                        // merge tool deltas into a buffer (by index) so we reconstruct JSON args
                        deltaTools.forEach((dt: any) => {
                            const idx = dt.index;
                            if (!toolCallsBuffer[idx]) {
                                toolCallsBuffer[idx] = { id: "", function: { name: "", arguments: "" } };
                            }
                            if (dt.id) toolCallsBuffer[idx].id = dt.id;
                            if (dt.function?.name) toolCallsBuffer[idx].function.name = dt.function.name;
                            if (dt.function?.arguments) {
                                toolCallsBuffer[idx].function.arguments += dt.function.arguments; // streamed JSON
                            }
                        });
                    }

                    // 3) When finish_reason is "tool_calls" or "stop", the first stream is done
                    const finish = choice?.finish_reason;
                    if (finish === "tool_calls" || finish === "stop") break;
                }

                if (sawToolCalls) {
                    // We streamed up to tool invocation. Execute tools, then follow up.
                    const toolMessage = {
                        role: "assistant" as const,
                        content: fullText || "",
                        tool_calls: toolCallsBuffer.map((t, i) => ({
                            id: t.id || `call_${i}`,
                            type: "function",
                            function: {
                                name: t.function.name,
                                arguments: t.function.arguments,
                            },
                        })),
                    };
                    this.messages.push(toolMessage as any);

                    for (const tc of toolMessage.tool_calls!) {
                        const fn = tc.function.name;
                        const args = JSON.parse(tc.function.arguments || "{}");
                        let toolResponse: any = null;

                        if (fn === "create_calendar_event") {
                            console.log(`[ChatGPT] Tool call: create_calendar_event`, args);
                            const { summary, location, description, start, end, name, dateOfBirth } = args;
                            const event = {
                                summary,
                                location,
                                description: `Appointment for ${name} (DOB: ${dateOfBirth}). ${description}`,
                                start: { dateTime: start, timeZone: "Europe/Amsterdam" },
                                end: { dateTime: end, timeZone: "Europe/Amsterdam" },
                                transparency: "opaque",
                                status: "confirmed",
                            };
                            await this.googleService.scheduleEvent(this.company!.id, event);
                            toolResponse = { success: true, event_summary: summary };
                            onTextGenerated(`Oké, de afspraak voor '${summary}' is ingepland. Kan ik nog iets anders voor je doen?`);

                        } else if (fn === "check_calendar_availability") {
                            console.log(`[ChatGPT] Tool call: check_calendar_availability`, args);
                            const { date } = args;

                            const dayOfWeek = new Date(date).getDay(); // 0=Sun -> use 7
                            const hoursForDay = this.companyContext?.hours.find(
                                (h) => h.dayOfWeek === (dayOfWeek === 0 ? 7 : dayOfWeek)
                            );

                            let openHour = 9;
                            let closeHour = 17;
                            if (hoursForDay?.isOpen && hoursForDay.openTime && hoursForDay.closeTime) {
                                const [oH] = hoursForDay.openTime.split(":").map(Number);
                                const [cH] = hoursForDay.closeTime.split(":").map(Number);
                                openHour = oH;
                                closeHour = cH;
                            }

                            const availableSlots = await this.googleService.getAvailableSlots(
                                this.company!.id,
                                date,
                                openHour,
                                closeHour
                            );

                            const summary = summarizeSlots(availableSlots, openHour, closeHour);
                            toolResponse = { availableSlots };

                            if (availableSlots.length > 0) {
                                onTextGenerated(`Op ${date} ${summary} Welke tijd schikt u?`);
                            } else {
                                onTextGenerated(`Sorry, er zijn geen beschikbare tijden op ${date}. Wilt u een andere datum proberen?`);
                            }

                        } else if (fn === "cancel_calendar_event") {
                            console.log(`[ChatGPT] Tool call: cancel_calendar_event`, args);
                            const { name, dateOfBirth, date } = args;
                            const success = await this.googleService.cancelEvent(this.company!.id, name, dateOfBirth, date);
                            toolResponse = { success };
                            if (success) {
                                onTextGenerated(`Oké, ik heb de afspraak voor ${name} op ${date} geannuleerd. Is er nog iets anders dat ik voor u kan doen?`);
                            } else {
                                onTextGenerated(`Sorry, ik kon geen afspraak vinden voor ${name} met de geboortedatum ${dateOfBirth} op ${date}. Controleer de gegevens en probeer het opnieuw.`);
                            }
                        }

                        this.messages.push({
                            tool_call_id: tc.id,
                            role: "tool",
                            content: JSON.stringify(toolResponse ?? {}),
                        });
                    }

                    // Follow-up completion after tools (non-streamed to keep code simple)
                    const final = await this.openai.chat.completions.create({
                        model: "gpt-4o-mini",
                        messages: this.messages,
                        temperature: 0.6,
                    });
                    const finalMsg = final.choices[0].message.content || "";
                    if (finalMsg) onTextGenerated(finalMsg);
                    this.messages.push({ role: "assistant", content: finalMsg });

                } else {
                    // No tool calls — we already streamed full text
                    this.messages.push({ role: "assistant", content: fullText });
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

        const { details, contact, hours, info } = this.companyContext;

        let prompt = `Je bent een behulpzame Nederlandse spraakassistent voor het bedrijf '${this.company.name}'. ${this.replyStyle.description}
 je praat zo menselijk mogelijk
 het is vandaag ${new Date().toLocaleDateString('nl-NL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
 
 Vermijd het gebruik van numerieke datum- en tijdnotatie (zoals 'dd-mm-jj', '14-08-25' of '10:00'). Schrijf tijden en datums altijd voluit in natuurlijke taal, bijvoorbeeld 'tien uur' en '14 augustus 2025'.`;

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
            hours.forEach((hour) => {
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
            info.forEach((i) => {
                prompt += `- ${i.value}\n`;
            });
        }

        prompt += "\n";

        if (this.hasGoogleIntegration) {
            prompt += "BELANGRIJKE INSTRUCTIE: Je hebt toegang tot de Google Agenda van het bedrijf. Gebruik ALTIJD de 'check_calendar_availability' tool om te controleren op beschikbare tijden voordat je een afspraak voorstelt. Vraag de gebruiker om hun volledige naam en geboortedatum voor je de afspraak inplant met 'create_calendar_event'. Deze gegevens zijn nodig om de afspraak later te kunnen annuleren met 'cancel_calendar_event'. Vraag altijd om een expliciete bevestiging voordat je de afspraak definitief inplant.";
        } else {
            prompt += "BELANGRIJKE INSTRUCTIE: Je hebt GEEN toegang tot de agenda. Als een gebruiker een afspraak wil maken, informeer hen dan dat je dit niet automatisch kunt doen. Bied aan om een notitie achter te laten voor het team of om de gebruiker door te verbinden met een medewerker.";
        }

        return prompt;
    }

    private getTools(): ChatCompletionTool[] {
        if (!this.hasGoogleIntegration) return [];
        return [
            {
                type: "function",
                function: {
                    name: "create_calendar_event",
                    description:
                        "Maak een nieuw evenement aan in de Google Agenda. Vraag eerst naar de datum en tijd en als er een datum en tijd en vastgesteld vraag dan naar de naam en geboortedatum van de klant.",
                    parameters: {
                        type: "object",
                        properties: {
                            summary: { type: "string", description: "De titel van de afspraak" },
                            location: { type: "string", description: "De locatie van de afspraak" },
                            description: { type: "string", description: "Een beschrijving van de afspraak" },
                            start: { type: "string", description: "De starttijd in ISO 8601 formaat (e.g., 2025-07-21T10:00:00)" },
                            end: { type: "string", description: "De eindtijd in ISO 8601 formaat (e.g., 2025-07-21T11:00:00)" },
                            name: { type: "string", description: "De volledige naam van de klant" },
                            dateOfBirth: { type: "string", description: "De geboortedatum van de klant (DD-MM-YYYY)" },
                        },
                        required: ["summary", "start", "end", "name", "dateOfBirth"],
                    },
                },
            },
            {
                type: "function",
                function: {
                    name: "check_calendar_availability",
                    description: "Controleer de beschikbaarheid in de agenda voor een specifieke datum.",
                    parameters: {
                        type: "object",
                        properties: {
                            date: { type: "string", description: "De datum om te controleren in YYYY-MM-DD formaat" },
                        },
                        required: ["date"],
                    },
                },
            },
            {
                type: "function",
                function: {
                    name: "cancel_calendar_event",
                    description: "Annuleer een afspraak op basis van naam, geboortedatum en de datum van de afspraak.",
                    parameters: {
                        type: "object",
                        properties: {
                            name: { type: "string", description: "De volledige naam van de klant" },
                            dateOfBirth: { type: "string", description: "De geboortedatum van de klant (DD-MM-YYYY)" },
                            date: { type: "string", description: "De datum van de afspraak in YYYY-MM-DD formaat" },
                        },
                        required: ["name", "dateOfBirth", "date"],
                    },
                },
            },
        ];
    }
}
