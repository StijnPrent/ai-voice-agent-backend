export class TranscriptNotReadyError extends Error {
    constructor(message = "Call transcript is not ready yet.") {
        super(message);
        this.name = "TranscriptNotReadyError";
    }
}
