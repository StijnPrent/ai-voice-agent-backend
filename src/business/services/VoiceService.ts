import {inject, injectable} from "tsyringe";
import {WhisperClient} from "../../clients/WhisperClient";
import {ChatGPTClient} from "../../clients/ChatGPTClient";
import {ElevenLabsClient} from "../../clients/ElevenLabsClient";

@injectable()
export class VoiceService {
    constructor(
        @inject(WhisperClient) private whisperClient: WhisperClient,
        @inject(ChatGPTClient) private chatGptClient: ChatGPTClient,
        @inject(ElevenLabsClient) private elevenLabsClient: ElevenLabsClient
    ) {}

    /**
     * Orchestrates transcription and chat completion.
     */
    async processConversation(recordingUrl: string): Promise<string> {
        // Twilio returns a URL to a WAV by default
        const transcript = await this.whisperClient.transcribe(`${recordingUrl}`);
        return await this.chatGptClient.getReply(transcript);
    }
}
