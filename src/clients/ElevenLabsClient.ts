import WebSocket from "ws";
import { VoiceSettingModel } from "../business/models/VoiceSettingsModel";

export class ElevenLabsClient {
    private readonly apiKey = process.env.ELEVENLABS_API_KEY!;
    private ws: WebSocket | null = null;
    private streamStarted = false;

    /**
     * One-shot helper (kept for compatibility).
     * For lowest latency, prefer beginStream/sendText/endStream.
     */
    public speak(
        text: string,
        settings: VoiceSettingModel,
        onStreamStart: () => void,
        onAudio: (audio: string) => void,
        onClose: () => void
    ) {
        this.beginStream(settings, onStreamStart, onAudio, onClose, () => {
            this.sendText(text);
            this.endStream();
        });
    }

    /**
     * Open a stream-input session.
     * When 'onReady' fires, you can call sendText() multiple times with partial text.
     */
    public beginStream(
        settings: VoiceSettingModel,
        onStreamStart: () => void,
        onAudio: (audioB64Ulaw: string) => void,
        onClose: () => void,
        onReady?: () => void
    ) {
        this.stop(); // close any previous stream first

        const url = `wss://api.elevenlabs.io/v1/text-to-speech/${settings.voiceId}/stream-input?model_id=eleven_multilingual_v2&output_format=ulaw_8000`;
        this.ws = new WebSocket(url, { headers: { "xi-api-key": this.apiKey } });
        this.streamStarted = false;

        this.ws.on("open", () => {
            if (this.ws?.readyState !== WebSocket.OPEN) return;

            // Initial config (no text yet). You can tweak settings here.
            this.ws.send(
                JSON.stringify({
                    voice_settings: {
                        stability: 0.35,
                        similarity_boost: 0.8,
                        speed: settings.talkingSpeed, // e.g. 1.0 = normal
                    },
                })
            );

            if (onReady) onReady();
        });

        this.ws.on("message", (data) => {
            try {
                const res = JSON.parse(data.toString());
                if (res.audio) {
                    if (!this.streamStarted) {
                        onStreamStart();
                        this.streamStarted = true;
                    }
                    onAudio(res.audio); // base64 uLaw 8k audio chunk
                }
            } catch (e) {
                console.error("[ElevenLabs] Failed to parse message:", e);
            }
        });

        this.ws.on("close", (code, reason) => {
            if (code !== 1000 && code !== 1005) {
                console.error(`[ElevenLabs] WS closed unexpectedly. code=${code}, reason=${reason.toString()}`);
            }
            this.ws = null;
            this.streamStarted = false;
            onClose();
        });

        this.ws.on("error", (err) => {
            console.error("[ElevenLabs] Connection error:", err);
            try { this.ws?.close(1011); } catch {}
            this.ws = null;
            this.streamStarted = false;
            onClose();
        });
    }

    /**
     * Send more text (can be called repeatedly as tokens arrive).
     * ElevenLabs will start speaking as soon as possible.
     */
    public sendText(text: string) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        if (!text) return;

        // (Optional) guard extremely long chunks; smaller chunks reduce latency
        const MAX_CHUNK = 800; // chars
        if (text.length > MAX_CHUNK) {
            for (let i = 0; i < text.length; i += MAX_CHUNK) {
                const slice = text.slice(i, i + MAX_CHUNK);
                this.ws.send(JSON.stringify({ text: slice }));
            }
        } else {
            this.ws.send(JSON.stringify({ text }));
        }
    }

    /**
     * Signal no more text—TTS will finish and then close by itself.
     * (You can also keep the socket open if you want to append more later,
     * but typically one assistant turn = one begin/end.)
     */
    public endStream() {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        // Empty text ends the stream per ElevenLabs docs
        this.ws.send(JSON.stringify({ text: "" }));
    }

    /**
     * Force-close the current stream (e.g., call ended).
     */
    public stop() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            console.log("[ElevenLabs] Stopping current speech stream.");
            try { this.ws.close(1000); } catch {}
        }
        this.ws = null;
        this.streamStarted = false;
    }
}
