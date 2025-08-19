// Enhanced debugging version of ElevenLabsClient.ts
import WebSocket from "ws";
import { VoiceSettingModel } from "../business/models/VoiceSettingsModel";

export class ElevenLabsClient {
    private readonly apiKey = process.env.ELEVENLABS_API_KEY!;
    private ws: WebSocket | null = null;
    private streamStarted = false;
    private pendingText: string[] = [];
    private hasTriggered = false;
    private idleFlushTimer: NodeJS.Timeout | null = null;
    private firstTextSent = false;    // ← new
    private sessionCfg: any = null;

    // Build URL once; Twilio expects 8k u-law
    private urlFor(voiceId: string) {
        const url = `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input?model_id=eleven_multilingual_v2&output_format=ulaw_8000`;
        console.log(`[ElevenLabs] Connecting to URL: ${url}`);
        return url;
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
        console.log(`[ElevenLabs] speak() called with text: "${text.slice(0, 100)}..."`);
        console.log(`[ElevenLabs] speak() settings:`, { voiceId: settings.voiceId, speed: settings.talkingSpeed });

        // Validate API key
        if (!this.apiKey) {
            console.error("[ElevenLabs] API key is missing!");
            onClose();
            return;
        }

        // Close any existing stream first
        this.stop();

        const url = this.urlFor(settings.voiceId);
        this.ws = new WebSocket(url, { headers: { "xi-api-key": this.apiKey } });
        this.streamStarted = false;

        this.ws.on("open", () => {
            console.log("[ElevenLabs] speak() WebSocket opened");
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                console.error("[ElevenLabs] speak() WebSocket not open in open handler");
                return;
            }

            // IMPORTANT: send voice_settings + initial text together
            const payload = {
                voice_settings: {
                    stability: 0.35,
                    similarity_boost: 0.8,
                    speed: settings.talkingSpeed,
                },
                text,
                try_trigger_generation: true,
                flush: true
            };

            console.log("[ElevenLabs] speak() sending initial payload:", JSON.stringify(payload, null, 2));

            try {
                this.ws.send(JSON.stringify(payload));
                console.log("[ElevenLabs] speak() sent initial message successfully");

                // End immediately for one-shot
                this.ws.send(JSON.stringify({ text: "" }));
                console.log("[ElevenLabs] speak() sent end message");
            } catch (e) {
                console.error("[ElevenLabs] speak() initial send failed:", e);
            }
        });

        this.ws.on("message", (data, isBinary) => {
            console.log(`[ElevenLabs] speak() received message - binary: ${isBinary}, length: ${data}`);

            try {
                if (isBinary) {
                    // This should be audio data in newer API versions
                    const b64 = data.toString("base64");
                    console.log(`[ElevenLabs] speak() received BINARY audio data, base64 length: ${b64.length}`);

                    if (!this.streamStarted) {
                        console.log("[ElevenLabs] speak() triggering onStreamStart");
                        onStreamStart();
                        this.streamStarted = true;
                    }
                    onAudio(b64);
                    return;
                }

                // Text message - parse as JSON
                const res = JSON.parse(data.toString());
                console.log("[ElevenLabs] speak() received JSON message:", res);

                // ElevenLabs may send non-audio events; we only forward audio
                if (res.audio) {
                    console.log(`[ElevenLabs] speak() received audio in JSON, length: ${res.audio.length}`);
                    if (!this.streamStarted) {
                        console.log("[ElevenLabs] speak() triggering onStreamStart");
                        onStreamStart();
                        this.streamStarted = true;
                    }
                    onAudio(res.audio); // base64 uLaw 8k audio
                } else if (res?.error) {
                    console.error("[ElevenLabs] speak() server error:", res.error);
                } else if (res?.isFinal) {
                    console.log("[ElevenLabs] speak() received isFinal message");
                } else {
                    console.log("[ElevenLabs] speak() received other message type:", res);
                }
            } catch (e) {
                console.error("[ElevenLabs] speak() JSON parse error:", e);
                console.error("[ElevenLabs] speak() raw data:", data.toString());
            }
        });

        this.ws.on("close", (code, reason) => {
            console.log(`[ElevenLabs] speak() WebSocket closed - code: ${code}, reason: ${reason.toString()}`);
            if (code !== 1000 && code !== 1005) {
                console.error(`[ElevenLabs] speak() WS closed unexpectedly code=${code} reason=${reason.toString()}`);
            }
            this.ws = null;
            this.streamStarted = false;
            onClose();
        });

        this.ws.on("error", (err) => {
            console.error("[ElevenLabs] speak() connection error:", err);
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
        console.log(`[ElevenLabs] beginStream() called with voiceId: ${settings.voiceId}`);

        // Validate API key
        if (!this.apiKey) {
            console.error("[ElevenLabs] API key is missing!");
            onClose();
            return;
        }

        // Close any previous stream first
        this.stop();
        this.pendingText = [];
        this.firstTextSent = false;
        this.streamStarted = false;

        const url = this.urlFor(settings.voiceId);
        this.ws = new WebSocket(url, { headers: { "xi-api-key": this.apiKey } });

        this.ws.on("open", () => {
            console.log("[ElevenLabs] beginStream() WebSocket opened");
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

            // store config for FIRST text
            this.sessionCfg = {
                voice_settings: {
                    stability: 0.5,
                    similarity_boost: 0.8,
                    speed: settings.talkingSpeed,
                },
                generation_config: { optimize_streaming_latency: 2 }
            };

            // If text was queued before open, send the FIRST one with config + trigger
            if (this.pendingText.length) {
                this.flushPendingFirst(); // sends first with config, rest as {text}
            }

            onReady && onReady(); // optional
        });

        this.ws.on("message", (data: Buffer, isBinary: boolean) => {
            console.log(`[ElevenLabs] beginStream() received message - binary: ${isBinary}, length: ${data.length}`);

            try {
                if (isBinary) {
                    // ← dit zijn de audio-chunks
                    const b64 = data.toString("base64");
                    console.log(`[ElevenLabs] beginStream() received BINARY audio data, base64 length: ${b64.length}`);

                    if (!this.streamStarted) {
                        console.log("[ElevenLabs] beginStream() triggering onStreamStart");
                        onStreamStart();
                        this.streamStarted = true;
                    }
                    onAudio(b64);
                    return;
                }

                // ← JSON control frames (alignment, final, errors, etc.)
                const text = data.toString("utf8");
                const res = JSON.parse(text);
                console.log("[ElevenLabs] beginStream() received JSON control:", res);

                if (res?.error) {
                    console.error("[ElevenLabs] beginStream() server error:", res.error);
                    return;
                }
                if (res?.isFinal) {
                    console.log("[ElevenLabs] beginStream() received isFinal");
                    return;
                }
                if (res?.audio) {
                    console.log(`[ElevenLabs] beginStream() received audio in JSON, length: ${res.audio.length}`);
                    if (!this.streamStarted) {
                        console.log("[ElevenLabs] beginStream() triggering onStreamStart");
                        onStreamStart();
                        this.streamStarted = true;
                    }
                    onAudio(res.audio);
                }

            } catch (e) {
                console.error("[ElevenLabs] beginStream() message parse error:", e);
                console.error("[ElevenLabs] beginStream() raw data:", data.toString().slice(0, 200));
            }
        });

        this.ws.on("close", (code, reason) => {
            console.log(`[ElevenLabs] beginStream() WebSocket closed - code: ${code}, reason: ${reason.toString()}`);
            if (code !== 1000 && code !== 1005) {
                console.error(`[ElevenLabs] beginStream() WS closed unexpectedly code=${code} reason=${reason.toString()}`);
            }
            this.ws = null;
            this.streamStarted = false;
            onClose();
        });

        this.ws.on("error", (err) => {
            console.error("[ElevenLabs] beginStream() connection error:", err);
            try { this.ws?.close(1011); } catch {}
            this.ws = null;
            this.streamStarted = false;
            onClose();
        });
    }

    /** Send more text (can be called multiple times as tokens arrive). */
    public sendText(text: string) {
        console.log(`[ElevenLabs] sendText() called with: "${text.slice(0, 80)}..."`);
        if (!text || !text.trim()) {
            console.log("[ElevenLabs] sendText() ignoring empty text");
            return;
        }

        // queue if WS not open
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.log("[ElevenLabs] sendText() WebSocket not open, queuing text");
            this.pendingText.push(text);
            return;
        }

        try {
            if (!this.firstTextSent) {
                // FIRST text: include config + trigger
                const payload = {
                    ...(this.sessionCfg ?? {}),
                    text,
                    try_trigger_generation: true,
                };
                console.log(`[ElevenLabs] sendText() FIRST payload: ${JSON.stringify(payload).slice(0,200)}`);
                this.ws.send(JSON.stringify(payload));
                this.firstTextSent = true;              // also replaces hasTriggered=true
            } else {
                // Subsequent chunks: plain text only
                const payload = { text };
                console.log(`[ElevenLabs] sendText() payload: ${JSON.stringify(payload)}`);
                this.ws.send(JSON.stringify(payload));
            }
            // Do NOT idle-flush here
        } catch (e) {
            console.error("[ElevenLabs] sendText() failed:", e);
        }
    }

    /** Signal no more text — TTS will finish and then close. */
    public endStream() {
        console.log("[ElevenLabs] endStream() called");
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        this.ws.send(JSON.stringify({ flush: true })); // one flush at the end
    }

    /** Force close (e.g., user interruption / call ended). */
    public stop() {
        console.log("[ElevenLabs] stop() called");
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            try {
                console.log("[ElevenLabs] stop() closing WebSocket");
                this.ws.close(1000);
            } catch (e) {
                console.error("[ElevenLabs] stop() error closing WebSocket:", e);
            }
        }
        this.ws = null;
        this.streamStarted = false;
        this.pendingText = [];
        this.hasTriggered = false;
        this.firstTextSent = false;
        this.sessionCfg = null
    }

    private flushPendingFirst() {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        const first = this.pendingText.shift();
        if (first && first.trim() && !this.firstTextSent) {
            const payload = { ...this.sessionCfg, text: first, try_trigger_generation: true };
            this.ws.send(JSON.stringify(payload));         // FIRST text carries config + trigger
            this.firstTextSent = true;
        }
        for (const t of this.pendingText) {
            if (t.trim()) this.ws.send(JSON.stringify({ text: t }));
        }
        this.pendingText = [];
    }

}