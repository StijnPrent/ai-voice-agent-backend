import { Request, Response } from "express";
import { container } from "tsyringe";
import { VoiceService } from "../business/services/VoiceService";

export class VoiceController {
    async handleIncomingCall(req: Request, res: Response) {
        const service = container.resolve(VoiceService);
        try {
            await service.processCall();
            res.status(200).send("Processed");
        } catch (e) {
            res.status(500).send("Error");
        }
    }

    async handleLocalTest(req: Request, res: Response) {
        const service = container.resolve(VoiceService);
        try {
            await service.processCallTest();
            res.status(200).send("✅ Local test completed, check audio/output.mp3");
        } catch (e) {
            console.error("❌ Local test failed:", e);
            res.status(500).send("Error in local test");
        }
    }
}