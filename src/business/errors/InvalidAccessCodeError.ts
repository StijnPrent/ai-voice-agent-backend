export class InvalidAccessCodeError extends Error {
    constructor(
        message = "Invalid or expired access code.",
        public readonly statusCode: number = 403
    ) {
        super(message);
        this.name = "InvalidAccessCodeError";
    }
}
