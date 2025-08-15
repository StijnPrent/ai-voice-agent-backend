// Buffers LLM deltas and flushes to ElevenLabs at sentence boundaries
// or after a short debounce, so speech starts early but stays natural.

export type SendFn = (text: string) => void;

export class ElevenPhraseStreamer {
    private buf = "";
    private timer: NodeJS.Timeout | null = null;

    constructor(
        private readonly send: SendFn,
        private readonly debounceMs = 220
    ) {}

    push(delta: string) {
        if (!delta) return;
        this.buf += delta;

        // Flush immediately on sentence boundary
        if (/[.!?…]\s$/.test(this.buf)) {
            this.flush();
            return;
        }

        // Otherwise, schedule a short flush
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => this.flush(), this.debounceMs);
    }

    flush() {
        const out = this.buf.trim();
        if (!out) return;
        this.buf = "";
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }
        // trailing space helps the next chunk sound natural
        this.send(out + " ");
    }

    end() {
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }
        this.flush();
    }
}
