import axios from "axios";

type SendTextInput = {
    phoneNumberId: string;
    to: string;
    text: string;
    accessToken: string;
    replyToMessageId?: string | null;
};

export class WhatsappClient {
    private readonly apiVersion: string;
    private readonly baseUrl: string;

    constructor() {
        this.apiVersion = process.env.WHATSAPP_API_VERSION || "v20.0";
        this.baseUrl =
            process.env.WHATSAPP_API_BASE_URL ||
            `https://graph.facebook.com/${this.apiVersion}`;
    }

    public async sendText(input: SendTextInput): Promise<void> {
        const { phoneNumberId, to, text, accessToken, replyToMessageId } = input;
        const url = `${this.baseUrl.replace(/\/$/, "")}/${phoneNumberId}/messages`;

        const payload: Record<string, unknown> = {
            messaging_product: "whatsapp",
            to,
            type: "text",
            text: { body: text },
        };

        if (replyToMessageId) {
            payload.context = { message_id: replyToMessageId };
        }

        await axios.post(url, payload, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
            },
            timeout: 8000,
        });
    }
}
