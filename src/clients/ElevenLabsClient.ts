// src/clients/ElevenLabsClient.ts
import WebSocket from "ws";

export class ElevenLabsClient {
    private readonly voiceId = process.env.ELEVENLABS_VOICE_ID!;
    private readonly apiKey  = process.env.ELEVENLABS_API_KEY!;

    public speak(
        text: string,
        onStreamStart: () => void,
        onAudio: (audio: string) => void, // Changed to string
        onClose: () => void
    ) {
        const url = `wss://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream-input?model_id=eleven_multilingual_v2&output_format=ulaw_8000`;
        const ws = new WebSocket(url, { headers: { "xi-api-key": this.apiKey } });
        let streamStarted = false;

        ws.on("open", () => {
            ws.send(JSON.stringify({
                voice_settings: { stability: 0.5, similarity_boost: 0.8 },
                text: " "
            }));
            ws.send(JSON.stringify({ text }));
            ws.send(JSON.stringify({ text: "" }));
        });

        ws.on("message", (data) => {
            const res = JSON.parse(data.toString());
            if (res.audio) {
                console.log(`[ElevenLabs] Audio chunk received, length: ${res.audio.length}`);
                console.log(`[ElevenLabs] First 20 chars: ${res.audio.substring(0, 20)}`);

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