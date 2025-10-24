// src/clients/TwilioClient.ts
import { injectable } from "tsyringe";
import twilio from "twilio";

type TransferOptions = {
    callerId?: string | null;
    reason?: string | null;
};

@injectable()
export class TwilioClient {
    private client: any;

    constructor() {
        this.client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH);
    }

    sendAudio(to: string, from: string, audioUrl: string) {
        return this.client.calls.create({ url: audioUrl, to, from });
    }

    async transferCall(callSid: string, target: string, options?: TransferOptions) {
        const response = new twilio.twiml.VoiceResponse();
        const dialOptions: Record<string, string> = {};

        if (options?.callerId) {
            dialOptions.callerId = options.callerId;
        }

        const dial = response.dial(dialOptions);
        dial.number(target);

        return this.client.calls(callSid).update({
            twiml: response.toString(),
        });
    }
}

