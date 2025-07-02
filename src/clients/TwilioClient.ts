import { injectable } from "tsyringe";
import twilio from "twilio";
import config from "../config/config"
import axios from "axios";

@injectable()
export class TwilioClient {
    private client: any;

    constructor() {
        this.client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH);
    }

    getAudio(recordingUrl: string) {
        return await axios.get(recordingUrl);
    }

    sendAudio(to: string, from: string, audioUrl: string) {
        return this.client.calls.create({ url: audioUrl, to, from });
    }
}