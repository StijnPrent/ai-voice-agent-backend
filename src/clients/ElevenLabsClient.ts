// src/clients/ElevenLabsClient.ts
import WebSocket from "ws";
import { VoiceSettingModel } from "../business/models/VoiceSettingsModel";
import { SpeechFormatter } from "../utils/tts/SpeechFormatter";

export class ElevenLabsClient {
    private readonly apiKey = process.env.ELEVENLABS_API_KEY!;
    private ws: WebSocket | null = null;

    public speak(
        text: string,
        settings: VoiceSettingModel,
        onStreamStart: () => void,
        onAudio: (audio: string) => void,
        onClose: () => void
    ) {
        this.stop(); // Stop any previous stream

        const url = `wss://api.elevenlabs.io/v1/text-to-speech/${settings.voiceId}/stream-input?model_id=eleven_multilingual_v2&output_format=ulaw_8000`;
        this.ws = new WebSocket(url, { headers: { "xi-api-key": this.apiKey } });
        let streamStarted = false;

        this.ws.on("open", async () => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    voice_settings: {
                        stability: 0.35,
                        similarity_boost: 0.8,
                        speed: settings.talkingSpeed
                    }
                }));

                const textChunks = SpeechFormatter.format(text);

                for (const chunk of textChunks) {
                    if (this.ws?.readyState !== WebSocket.OPEN) break;

                    if (chunk.startsWith('<silence_m_s_')) {
                        const duration = parseInt(chunk.split('_')[3].replace('>', ''));
                        await new Promise(resolve => setTimeout(resolve, duration));
                    } else {
                        this.ws.send(JSON.stringify({
                            text: chunk + " ",
                            try_trigger_generation: true
                        }));
                    }
                }

                if (this.ws?.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({ text: "" }));
                }
            }
        });

        this.ws.on("message", (data) => {
            const res = JSON.parse(data.toString());
            if (res.audio) {
                if (!streamStarted) {
                    onStreamStart();
                    streamStarted = true;
                }
                onAudio(res.audio);
            }
        });

        this.ws.on("close", (code, reason) => {
            if (code !== 1000 && code !== 1005) {
                console.error(`[ElevenLabs] WS closed unexpectedly. code=${code}, reason=${reason.toString()}`);
            }
            this.ws = null;
            onClose();
        });

        this.ws.on("error", (err) => {
            console.error("[ElevenLabs] Connection error:", err);
            if (this.ws) {
                this.ws.close(1011); // Internal error
            }
            this.ws = null;
            onClose();
        });
    }

    public stop() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            console.log("[ElevenLabs] Stopping current speech stream.");
            this.ws.close(1000);
        }
        this.ws = null;
    }
}
