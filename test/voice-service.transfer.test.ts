import "reflect-metadata";
import { VoiceService } from "../src/business/services/VoiceService";

describe("VoiceService.transferCall", () => {
    let service: VoiceService;
    let twilioClient: { transferCall: jest.Mock };

    const createService = () => {
        twilioClient = { transferCall: jest.fn().mockResolvedValue({}) };

        service = new VoiceService(
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            twilioClient as any
        );
    };

    beforeEach(() => {
        createService();
        (service as any).callSid = "CA123";
        (service as any).companyTransferNumber = "+31123456789";
        (service as any).companyTwilioNumber = "+31098765432";
    });

    it("transfers the call to the provided number", async () => {
        const result = await service.transferCall(" +31 88 123 4567 ", {
            callSid: "CAOVERRIDE",
            callerId: " +31 06 12345678 ",
            reason: "doorverbinden naar receptie",
        });

        expect(twilioClient.transferCall).toHaveBeenCalledWith("CAOVERRIDE", "+31881234567", {
            callerId: "+310612345678",
            reason: "doorverbinden naar receptie",
        });
        expect(result).toEqual({ transferredTo: "+31881234567", callSid: "CAOVERRIDE" });
    });

    it("falls back to the company transfer number when none is provided", async () => {
        const result = await service.transferCall(undefined, {});

        expect(twilioClient.transferCall).toHaveBeenCalledWith("CA123", "+31123456789", {
            callerId: "+31098765432",
            reason: null,
        });
        expect(result).toEqual({ transferredTo: "+31123456789", callSid: "CA123" });
    });

    it("throws when no valid target number is available", async () => {
        (service as any).companyTransferNumber = null;

        await expect(service.transferCall(undefined, {})).rejects.toThrow(
            "Er is geen geldig doelnummer voor doorverbinden beschikbaar."
        );
        expect(twilioClient.transferCall).not.toHaveBeenCalled();
    });

    it("throws when the callSid cannot be resolved", async () => {
        (service as any).callSid = null;

        await expect(service.transferCall("+31123456789", {})).rejects.toThrow(
            "Er is geen actieve callSid beschikbaar om door te verbinden."
        );
        expect(twilioClient.transferCall).not.toHaveBeenCalled();
    });
});

