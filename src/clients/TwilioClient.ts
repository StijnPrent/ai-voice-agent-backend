import { injectable } from "tsyringe";
import twilio from "twilio";

@injectable()
export class TwilioClient {
    private client: any;

    constructor() {
        this.client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH);
    }

    sendAudio(to: string, from: string, audioUrl: string) {
        return this.client.calls.create({ url: audioUrl, to, from });
    }

    async transferCall(callSid: string, target: string, callerId?: string): Promise<void> {
        if (!callSid) {
            throw new Error("Missing call SID for transfer");
        }

        const trimmedTarget = target?.trim();
        if (!trimmedTarget) {
            throw new Error("Missing transfer target");
        }

        const response = new twilio.twiml.VoiceResponse();
        const dial = response.dial(callerId ? { callerId } : {});

        if (trimmedTarget.startsWith("sip:")) {
            dial.sip(trimmedTarget);
        } else {
            dial.number({}, trimmedTarget);
        }

        await this.client.calls(callSid).update({ twiml: response.toString() });
    }
}