// src/clients/ElevenLabsClient.ts
import WebSocket from "ws";
import { Writable } from "stream";

// μ-law decoding constants
const MU_LAW_MAX = 0x1FFF;
const MU_LAW_BIAS = 0x84; // 132

function muLawDecode(u_val: number): number {
    // invert all bits
    u_val = ~u_val;
    // extract and shift
    let t = ((u_val & 0x0F) << 3) + MU_LAW_BIAS;
    t <<= (u_val & 0x70) >> 4;
    return (u_val & 0x80) ? (MU_LAW_BIAS - t) : (t - MU_LAW_BIAS);
}

export class ElevenLabsClient {
    private mainOutputStream: Writable | null = null;
    private readonly voiceId = process.env.ELEVENLABS_VOICE_ID!;
    private readonly apiKey  = process.env.ELEVENLABS_API_KEY!;

    public connect(outputStream: Writable) {
        this.mainOutputStream = outputStream;
    }

    public speak(text: string, onStreamStart?: () => void) {
        if (!this.mainOutputStream) {
            console.error("[ElevenLabs] Output stream is not set. Call connect() first.");
            return;
        }

        const url = `wss://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream-input?model_id=eleven_multilingual_v2`;
        const ws = new WebSocket(url, { headers: { "xi-api-key": this.apiKey } });
        let streamStarted = false;

        ws.on("open", () => {
            // Send authentication/config + prime
            ws.send(JSON.stringify({
                voice_settings: { stability: 0.5, similarity_boost: 0.8 },
                output_format: "ulaw_8000",
                text: " "
            }));
            // Send text + end-of-input
            ws.send(JSON.stringify({ text }));
            ws.send(JSON.stringify({ text: "" }));
        });

        ws.on("message", (data) => {
            const res = JSON.parse(data.toString());
            if (res.audio) {
                // Decode μ-law to PCM16LE
                const muBuf = Buffer.from(res.audio, "base64");
                const pcmBuf = Buffer.alloc(muBuf.length * 2);
                for (let i = 0; i < muBuf.length; i++) {
                    const decoded = muLawDecode(muBuf[i]);
                    pcmBuf.writeInt16LE(decoded, i * 2);
                }
                if (!streamStarted) {
                    onStreamStart?.();
                    streamStarted = true;
                }
                this.mainOutputStream!.write(pcmBuf);
            }
        });

        ws.on("close", (code, reason) => {
            if (code !== 1000) {
                console.error(`[ElevenLabs] WS closed unexpectedly. code=${code}, reason=${reason}`);
            }
        });

        ws.on("error", (err) => {
            console.error("[ElevenLabs] Connection error:", err);
        });
    }

    public close() {
        this.mainOutputStream = null;
    }
}
