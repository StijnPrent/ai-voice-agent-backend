export class AssistantSyncError extends Error {
    public readonly messages: string[];
    public readonly statusCode: number;

    constructor(messages: string[], statusCode = 500) {
        super(messages[0] ?? "Assistant sync failed");
        this.name = "AssistantSyncError";
        this.messages = messages.length > 0 ? messages : ["Assistant sync failed"];
        this.statusCode = statusCode;
    }
}

export default AssistantSyncError;
