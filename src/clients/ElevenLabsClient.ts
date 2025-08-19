// src/clients/ElevenLabsClient.ts
import WebSocket from "ws";
import { VoiceSettingModel } from "../business/models/VoiceSettingsModel";

export class ElevenLabsClient {
    private readonly apiKey = process.env.ELEVENLABS_API_KEY!;
    private ws: WebSocket | null = null;
    private streamStarted = false;
    private pendingText: string[] = [];
    private hasTriggered = false;
    private idleFlushTimer: NodeJS.Timeout | null = null;

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
                        text,
                        try_trigger_generation: true,
                        flush: true
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
        this.hasTriggered = false;

        const url = this.urlFor(settings.voiceId);
        this.ws = new WebSocket(url, { headers: { "xi-api-key": this.apiKey } });
        this.streamStarted = false;

        this.ws.on("open", () => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
            try {
                this.ws.send(JSON.stringify({
                    voice_settings: {
                        stability: 0.5,
                        similarity_boost: 0.8,
                        speed: settings.talkingSpeed,
                    },
                    generation_config: { optimize_streaming_latency: 2 }
                }));
                // flush any queued text
                if (this.pendingText.length) this.flushPending(true);
                onReady && onReady();
            } catch (e) {
                console.error("[ElevenLabs] beginStream(): initial config send failed:", e);
            }
        });

        this.ws.on("message", (data: Buffer, isBinary: boolean) => {
            console.log("[EL] message", isBinary ? "binary" : "text", data.length);
            try {
                if (isBinary) {
                    // ← dit zijn de audio-chunks
                    const b64 = data.toString("base64");
                    if (!this.streamStarted) {
                        onStreamStart();
                        this.streamStarted = true;
                    }
                    onAudio(b64);
                    return;
                }

                // ← JSON control frames (alignment, final, errors, etc.)
                const text = data.toString("utf8");
                const res = JSON.parse(text);
                console.log("[EL] control:", res);

                if (res?.error) {
                    console.error("[ElevenLabs] server error:", res.error);
                    return;
                }
                if (res?.isFinal) {
                    // laatste control frame van deze generatie; geen audio hier
                    // console.log("[EL] final:", res);
                    return;
                }
                // evt. andere control types loggen
                // console.log("[EL] ctrl:", res);

            } catch (e) {
                console.error("[ElevenLabs] message parse error:", e);
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

        if (!text || !text.trim()) return;

        // Coalesce micro-chunks (LLM token dribble)
        const MAX_CHUNK = 400;           // smaller than before to reduce latency
        const MIN_BATCH_TO_TRIGGER = 40; // ~one short word/syllable threshold

        // queue if not open yet
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this.pendingText.push(text);
            return;
        }

        try {
            // Send the text chunk
            console.log("[EL] sendText 2", text.slice(0,80));
            this.ws.send(JSON.stringify({ text }));

            // First real text? Nudge the server to start generating
            if (!this.hasTriggered && text.trim().length >= MIN_BATCH_TO_TRIGGER) {
                this.ws.send(JSON.stringify({ try_trigger_generation: true }));
                this.hasTriggered = true;
            }
            this.armIdleFlush();
        } catch (e) {
            console.error("[ElevenLabs] sendText() failed:", e);
        }
    }

    /** Signal no more text — TTS will finish and then close. */
    public endStream() {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        try {
            // ensure any remaining buffer is synthesized
            if (!this.hasTriggered) {
                this.ws.send(JSON.stringify({ try_trigger_generation: true }));
                this.hasTriggered = true;
            }
            this.ws.send(JSON.stringify({ flush: true }));
            this.ws.send(JSON.stringify({ text: "" }));
        } catch (e) {
            console.error("[ElevenLabs] endStream() failed:", e);
        } finally {
            this.clearIdleFlush();
        }
    }

    /** Force close (e.g., user interruption / call ended). */
    public stop() {
        this.clearIdleFlush();
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            try { this.ws.close(1000); } catch {}
        }
        this.ws = null;
        this.streamStarted = false;
        this.pendingText = [];
        this.hasTriggered = false;
    }

    private flushPending(trigger = false) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        for (const t of this.pendingText) this.ws.send(JSON.stringify({ text: t }));
        this.pendingText = [];
        if (trigger && !this.hasTriggered) {
            this.ws.send(JSON.stringify({ try_trigger_generation: true }));
            this.hasTriggered = true;
        }
        this.armIdleFlush();
    }

    private armIdleFlush() {
        this.clearIdleFlush();
        // if no new text for 250ms, force synthesis of what we have
        this.idleFlushTimer = setTimeout(() => {
            try {
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({ flush: true }));
                    if (!this.hasTriggered) {
                        this.ws.send(JSON.stringify({ try_trigger_generation: true }));
                        this.hasTriggered = true;
                    }
                }
            } catch {}
        }, 250);
    }

    private clearIdleFlush() {
        if (this.idleFlushTimer) { clearTimeout(this.idleFlushTimer); this.idleFlushTimer = null; }
    }
}
