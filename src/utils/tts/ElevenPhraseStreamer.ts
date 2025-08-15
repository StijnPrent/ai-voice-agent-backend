// src/utils/tts/ElevenPhraseStreamer.ts
type PushFn = (text: string) => void;

export class ElevenPhraseStreamer {
    private buf = "";
    private timer: NodeJS.Timeout | null = null;
    private readonly onFlush: PushFn;

    // Tunables
    private readonly softMs = 300;        // flush if no new tokens for 300ms
    private readonly minChars = 40;       // or when we hit ~one short phrase
    private readonly hardMs = 1200;       // absolute max wait

    private lastAnyFlush = 0;
    private hardTimer: NodeJS.Timeout | null = null;

    constructor(onFlush: PushFn) {
        this.onFlush = onFlush;
        this.lastAnyFlush = Date.now();
        this.armHardTimer();
    }

    push(delta: string) {
        if (!delta) return;
        this.buf += delta;

        // Sentence boundary?
        if (/[.!?…]\s*$/.test(this.buf) || this.buf.length >= this.minChars) {
            this.flush();
            return;
        }

        // Soft debounce: flush if no more tokens arrive
        this.armSoftTimer();
    }

    end() {
        // final remainder
        if (this.buf.trim()) {
            this.flush();
        }
        this.clearTimers();
    }

    private flush() {
        const text = this.buf.trim();
        this.buf = "";
        this.clearSoftTimer();
        this.armHardTimer();

        if (text) this.onFlush(text + " ");
        this.lastAnyFlush = Date.now();
    }

    private armSoftTimer() {
        this.clearSoftTimer();
        this.timer = setTimeout(() => this.flush(), this.softMs);
    }

    private clearSoftTimer() {
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    }

    private armHardTimer() {
        if (this.hardTimer) clearTimeout(this.hardTimer);
        this.hardTimer = setTimeout(() => {
            if (this.buf.trim()) this.flush();
            this.armHardTimer();
        }, this.hardMs);
    }

    private clearTimers() {
        this.clearSoftTimer();
        if (this.hardTimer) { clearTimeout(this.hardTimer); this.hardTimer = null; }
    }
}
