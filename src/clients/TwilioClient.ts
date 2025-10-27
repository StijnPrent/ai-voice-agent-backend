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
        const dialOptions: Record<string, unknown> = {};
        const numberOptions: Record<string, unknown> = {};

        if (options?.callerId) {
            dialOptions.callerId = options.callerId;
        }

        dialOptions.answerOnBridge = true;

        const serverUrl = process.env.SERVER_URL;
        if (serverUrl) {
            const actionUrl = `${serverUrl}/voice/twilio/dial-action`;
            const statusUrl = `${serverUrl}/voice/twilio/dial-status`;
            const statusEvents = ["initiated", "ringing", "answered", "completed"];

            dialOptions.action = actionUrl;
            dialOptions.method = "POST";
            dialOptions.statusCallback = statusUrl;
            dialOptions.statusCallbackMethod = "POST";
            dialOptions.statusCallbackEvent = statusEvents;

            numberOptions.statusCallback = statusUrl;
            numberOptions.statusCallbackMethod = "POST";
            numberOptions.statusCallbackEvent = statusEvents;
        } else {
            console.warn(
                "[TwilioClient] SERVER_URL is not configured; dial action and status callbacks are disabled."
            );
        }

        const dial = response.dial(dialOptions);
        dial.number(numberOptions, target);

        return this.client.calls(callSid).update({
            twiml: response.toString(),
        });
    }
}

