// src/clients/ElevenLabsClient.ts
import WebSocket from "ws";
import { VoiceSettingModel } from "../business/models/VoiceSettingsModel";

export class ElevenLabsClient {
    private readonly apiKey = process.env.ELEVENLABS_API_KEY!;
    private ws: WebSocket | null = null;
    private streamStarted = false;
    private pendingText: string[] = [];

    // Build URL once; Twilio expects 8k u-law
    private urlFor(voiceId: string) {
        return `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input?model_id=eleven_multilingual_v2&output_format=ulaw_8000`;
    }

    /**
     * One-shot helper: sends the text *in the very first message*
     * (voice_settings + text in the same payload), then a blank message to end.
     * This mirrors your old behavior so the welcome line works reliably.
     */
    public speak(
        text: string,
        settings: VoiceSettingModel,
        onStreamStart: () => void,
        onAudio: (audioB64Ulaw: string) => void,
        onClose: () => void
    ) {
        // Close any existing stream first
        this.stop();

        const url = this.urlFor(settings.voiceId);
        this.ws = new WebSocket(url, { headers: { "xi-api-key": this.apiKey } });
        this.streamStarted = false;

        this.ws.on("open", () => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
            // IMPORTANT: send voice_settings + initial text together
            try {
                this.ws.send(
                    JSON.stringify({
                        voice_settings: {
                            stability: 0.35,
                            similarity_boost: 0.8,
                            speed: settings.talkingSpeed,
                        },
                        text, // <- send actual content in first message
                    })
                );
                // End immediately for one-shot
                this.ws.send(JSON.stringify({ text: "" }));
            } catch (e) {
                console.error("[ElevenLabs] speak(): initial send failed:", e);
            }
        });

        this.ws.on("message", (data) => {
            try {
                const res = JSON.parse(data.toString());
                // ElevenLabs may send non-audio events; we only forward audio
                if (res.audio) {
                    if (!this.streamStarted) {
                        onStreamStart();
                        this.streamStarted = true;
                    }
                    onAudio(res.audio); // base64 uLaw 8k audio
                } else if (res?.error) {
                    console.error("[ElevenLabs] speak(): server error:", res.error);
                }
            } catch (e) {
                console.error("[ElevenLabs] speak(): JSON parse error:", e);
            }
        });

        this.ws.on("close", (code, reason) => {
            if (code !== 1000 && code !== 1005) {
                console.error(`[ElevenLabs] speak(): WS closed unexpectedly code=${code} reason=${reason.toString()}`);
            }
            this.ws = null;
            this.streamStarted = false;
            onClose();
        });

        this.ws.on("error", (err) => {
            console.error("[ElevenLabs] speak(): connection error:", err);
            try { this.ws?.close(1011); } catch {}
            this.ws = null;
            this.streamStarted = false;
            onClose();
        });
    }

    /**
     * Streaming session for LLM deltas.
     * First message sends only voice_settings. Then call sendText() repeatedly.
     * Finally call endStream() to signal completion.
     */
    public beginStream(
        settings: VoiceSettingModel,
        onStreamStart: () => void,
        onAudio: (audioB64Ulaw: string) => void,
        onClose: () => void,
        onReady?: () => void
    ) {
        // Close any previous stream first
        this.stop();
        this.pendingText = []; // reset

        const url = this.urlFor(settings.voiceId);
        this.ws = new WebSocket(url, { headers: { "xi-api-key": this.apiKey } });
        this.streamStarted = false;

        this.ws.on("open", () => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
            try {
                this.ws.send(JSON.stringify({
                    voice_settings: {
                        stability: 0.35,
                        similarity_boost: 0.8,
                        speed: settings.talkingSpeed,
                    },
                }));
                // flush any queued text
                if (this.pendingText.length) {
                    for (const t of this.pendingText) {
                        this.ws.send(JSON.stringify({ text: t }));
                    }
                    this.pendingText = [];
                }
                onReady && onReady();
            } catch (e) {
                console.error("[ElevenLabs] beginStream(): initial config send failed:", e);
            }
        });

        this.ws.on("message", (data) => {
            try {
                const res = JSON.parse(data.toString());
                if (res.audio) {
                    if (!this.streamStarted) {
                        onStreamStart();
                        this.streamStarted = true;
                    }
                    onAudio(res.audio);
                } else if (res?.error) {
                    console.error("[ElevenLabs] beginStream(): server error:", res.error);
                }
            } catch (e) {
                console.error("[ElevenLabs] beginStream(): JSON parse error:", e);
            }
        });

        this.ws.on("close", (code, reason) => {
            if (code !== 1000 && code !== 1005) {
                console.error(`[ElevenLabs] beginStream(): WS closed unexpectedly code=${code} reason=${reason.toString()}`);
            }
            this.ws = null;
            this.streamStarted = false;
            onClose();
        });

        this.ws.on("error", (err) => {
            console.error("[ElevenLabs] beginStream(): connection error:", err);
            try { this.ws?.close(1011); } catch {}
            this.ws = null;
            this.streamStarted = false;
            onClose();
        });
    }

    /** Send more text (can be called multiple times as tokens arrive). */
    public sendText(text: string) {
        console.log("[EL] sendText", JSON.stringify(text).slice(0,80));
        if (!text) return;
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this.pendingText.push(text); // queue until OPEN
            return;
        }
        try {
            const MAX_CHUNK = 800;
            if (text.length > MAX_CHUNK) {
                for (let i = 0; i < text.length; i += MAX_CHUNK) {
                    const slice = text.slice(i, i + MAX_CHUNK);
                    this.ws.send(JSON.stringify({ text: slice }));
                }
            } else {
                this.ws.send(JSON.stringify({ text }));
            }
        } catch (e) {
            console.error("[ElevenLabs] sendText() failed:", e);
        }
    }

    /** Signal no more text — TTS will finish and then close. */
    public endStream() {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        try {
            // Empty text ends the stream per ElevenLabs docs
            this.ws.send(JSON.stringify({ text: "" }));
        } catch (e) {
            console.error("[ElevenLabs] endStream() failed:", e);
        }
    }

    /** Force close (e.g., user interruption / call ended). */
    public stop() {
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            console.log("[ElevenLabs] Stopping current speech stream.");
            try { this.ws.close(1000); } catch {}
        }
        this.ws = null;
        this.streamStarted = false;
        this.pendingText = [];
    }
}
