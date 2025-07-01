import { injectable, inject } from "tsyringe";
import { WhisperClient } from "../../clients/WhisperClient";
import { ChatGPTClient } from "../../clients/ChatGPTClient";
import { ElevenLabsClient } from "../../clients/ElevenLabsClient";
import { TwilioClient } from "../../clients/TwilioClient";
import config from "../../config/config";
import {CompanyService} from "./CompanyService";
import {GoogleService} from "./GoogleService";

@injectable()
export class VoiceService {
    constructor(
        @inject("WhisperClient") private whisper: WhisperClient,
        @inject("ChatGPTClient") private chatgpt: ChatGPTClient,
        @inject("ElevenLabsClient") private tts: ElevenLabsClient,
        @inject("TwilioClient") private twilio: TwilioClient,
        @inject("CompanyService") private companyService: CompanyService,
        @inject("GoogleService") private calendarService: GoogleService
    ) {}

    async processCallTest(): Promise<void> {
        const transcription = await this.whisper.transcribe("./audio/Recording.m4a");
        const reply = await this.chatgpt.getReply(transcription);
        await this.tts.synthesizeSpeech(reply, "./audio/output.mp3");
        // await this.twilio.sendAudio(config.twilioTo, config.twilioFrom, "https://voiceagent/audio/output.mp3");
    }
    /**
     * Process an incoming call:
     * - Identify company by 'to' number
     * - Fetch FAQs
     * - Transcribe audio
     * - Generate AI reply with context
     * - Handle scheduling if intent detected
     * @param from Caller phone number
     * @param to   Your Twilio number that was called
     * @param recordingUrl URL to the call recording
     */
    async processCall(
        from: string,
        to: string,
        recordingUrl: string
    ): Promise<void> {
        // 1. Identify the company based on the Twilio 'to' number
        const company = await this.companyService.findByTwilioNumber(to);

        // 2. Load company-specific FAQ context
        const faqs = await this.companyService.getCompanyInfo(company.id);

        // 3. Transcribe the recording
        const transcription = await this.whisper.transcribe(recordingUrl);

        // 4. Build AI prompt with context and FAQ
        const promptParts = [
            `Bedrijf: ${company.name}`,
            "Veelgestelde vragen:",
            ...faqs.map(f => `info: ${f.value}`),
            `Gebruiker: ${transcription}`
        ];
        const prompt = promptParts.join("\n");
        const reply = await this.chatgpt.getReply(prompt);

        // 5. Check for appointment intent
        if (/afspraak|schedule/i.test(transcription + ' ' + reply)) {
            // Use CompanyService to parse date/time from transcription
            const event = await this.companyService.parseAppointment(
                transcription
            );

            // If the company has connected Google Calendar, schedule it
            if (company.isCalendarConnected) {
                await this.calendarService.scheduleEvent(company.id, event);
                const confirmation = `Uw afspraak is gepland op ${event.start?.dateTime}.`;
                await this.tts.synthesizeSpeech(
                    confirmation,
                    "./audio/output.mp3"
                );
                await this.twilio.sendAudio(
                    from,
                    config.twilioFrom,
                    `${config.serverUrl}/audio/output.mp3`
                );
                return;
            }
        }

        // 6. Default: respond with AI reply
        await this.tts.synthesizeSpeech(reply, "./audio/output.mp3");
        await this.twilio.sendAudio(
            from,
            config.twilioFrom,
            `${config.serverUrl}/audio/output.mp3`
        );
    }


}