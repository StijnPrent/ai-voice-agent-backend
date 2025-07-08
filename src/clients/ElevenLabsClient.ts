// src/clients/ElevenLabsClient.ts
import WebSocket from "ws";
import { VoiceSettingModel } from "../business/models/VoiceSettingsModel";

export class ElevenLabsClient {
    private readonly apiKey  = process.env.ELEVENLABS_API_KEY!;

    public speak(
        text: string,
        settings: VoiceSettingModel,
        onStreamStart: () => void,
        onAudio: (audio: string) => void,
        onClose: () => void
    ) {
        const url = `wss://api.elevenlabs.io/v1/text-to-speech/${settings.voiceId}/stream-input?model_id=eleven_multilingual_v2&output_format=ulaw_8000`;
        const ws = new WebSocket(url, { headers: { "xi-api-key": this.apiKey } });
        let streamStarted = false;

        ws.on("open", () => {
            ws.send(JSON.stringify({
                voice_settings: { 
                    stability: settings.stability, 
                    similarity_boost: settings.similarityBoost 
                },
                text: " "
            }));
            ws.send(JSON.stringify({ text }));
            ws.send(JSON.stringify({ text: "" }));
        });

        ws.on("message", (data) => {
            const res = JSON.parse(data.toString());
            if (res.audio) {
                if (!streamStarted) {
                    onStreamStart();
                    streamStarted = true;
                }
                onAudio(res.audio);
            }
        });

        ws.on("close", (code, reason) => {
            if (code !== 1000) {
                console.error(`[ElevenLabs] WS closed unexpectedly. code=${code}, reason=${reason}`);
            }
            onClose();
        });

        ws.on("error", (err) => {
            console.error("[ElevenLabs] Connection error:", err);
            onClose();
        });
    }
}
