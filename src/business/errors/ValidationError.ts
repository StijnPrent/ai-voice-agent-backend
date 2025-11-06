export class ValidationError extends Error {
    constructor(message = "Invalid request.") {
        super(message);
        this.name = "ValidationError";
    }
}
