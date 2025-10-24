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


}