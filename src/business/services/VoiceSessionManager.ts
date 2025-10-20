import { container, injectable, singleton } from "tsyringe";
import { VoiceService } from "./VoiceService";

@singleton()
@injectable()
export class VoiceSessionManager {
    private readonly sessions = new Map<string, VoiceService>();
    private readonly sessionsByVapiCallId = new Map<string, VoiceService>();

    /**
     * Create a new VoiceService instance for the provided callSid and keep
     * track of it so other parts of the system (transfer endpoints,
     * Twilio status callbacks, etc.) can interact with the correct call
     * state while multiple calls are active simultaneously.
     */
    public createSession(callSid: string): VoiceService {
        const voiceService = container.resolve(VoiceService);
        voiceService.bindSessionManager(this);
        const originalStop = voiceService.stopStreaming.bind(voiceService);

        voiceService.stopStreaming = ((reason?: string) => {
            try {
                originalStop(reason);
            } finally {
                this.releaseSession(callSid, voiceService);
            }
        }) as typeof voiceService.stopStreaming;

        this.sessions.set(callSid, voiceService);
        console.log(
            `[VoiceSessionManager] 🆕 Created VoiceService session`,
            this.describeSession(voiceService, callSid)
        );
        return voiceService;
    }

    /**
     * Retrieve the VoiceService instance associated with a callSid.
     */
    public getSession(callSid: string | undefined | null): VoiceService | undefined {
        if (!callSid) {
            return undefined;
        }

        const session = this.sessions.get(callSid);
        console.log(
            `[VoiceSessionManager] 🔎 Lookup by callSid ${callSid}: ${session ? "found" : "missing"}`
        );
        return session;
    }

    public findSessionByVapiCallId(callId: string | undefined | null): VoiceService | undefined {
        if (!callId) {
            return undefined;
        }

        const session = this.sessionsByVapiCallId.get(callId);
        console.log(
            `[VoiceSessionManager] 🔎 Lookup by Vapi callId ${callId}: ${session ? "found" : "missing"}`
        );
        return session;
    }

    /**
     * Resolve an active session when the callSid is optional. If the caller
     * does not provide a callSid we only return a session when there is a
     * single active call to avoid ambiguity.
     */
    public resolveActiveSession(callSid?: string | null): VoiceService | undefined {
        if (callSid) {
            const session = this.sessions.get(callSid);
            console.log(
                `[VoiceSessionManager] 🔁 resolveActiveSession explicit callSid=${callSid} -> ${
                    session ? "found" : "missing"
                }`
            );
            return session;
        }

        if (this.sessions.size === 1) {
            const single = this.sessions.values().next().value as VoiceService | undefined;
            if (single) {
                console.log("[VoiceSessionManager] 🔁 resolveActiveSession using sole active session");
                return single;
            }
        }

        console.warn(
            `[VoiceSessionManager] ⚠️ resolveActiveSession ambiguous (active=${this.sessions.size})`
        );
        return undefined;
    }

    /**
     * Remove the mapping for a call. If a specific VoiceService instance is
     * provided we only clear the session when it matches the registered
     * instance to guard against stale references.
     */
    public releaseSession(callSid: string | null | undefined, voiceService?: VoiceService) {
        if (!callSid) {
            return;
        }

        const existing = this.sessions.get(callSid);
        if (!existing) {
            return;
        }

        this.releaseVapiCallId(existing.getVapiCallId(), existing);

        if (!voiceService || existing === voiceService) {
            this.sessions.delete(callSid);
            console.log(
                `[VoiceSessionManager] 🗑️ Released VoiceService session`,
                this.describeSession(existing, callSid)
            );
        }
    }

    /**
     * Return the list of active call identifiers. Helpful for logging when a
     * request cannot be resolved to a specific call.
     */
    public listActiveCallSids(): string[] {
        return Array.from(this.sessions.keys());
    }

    public associateVapiCallId(callId: string | null | undefined, voiceService: VoiceService) {
        if (!callId) {
            return;
        }

        this.sessionsByVapiCallId.set(callId, voiceService);
        console.log(
            `[VoiceSessionManager] 🔗 Associated Vapi callId ${callId}`,
            this.describeSession(voiceService)
        );
    }

    public releaseVapiCallId(callId: string | null | undefined, voiceService?: VoiceService) {
        if (!callId) {
            return;
        }

        const existing = this.sessionsByVapiCallId.get(callId);
        if (!existing) {
            return;
        }

        if (!voiceService || existing === voiceService) {
            this.sessionsByVapiCallId.delete(callId);
            console.log(
                `[VoiceSessionManager] 🔓 Released Vapi callId ${callId}`,
                this.describeSession(existing)
            );
        }
    }

    private describeSession(service: VoiceService, callSidOverride?: string) {
        return {
            callSid: callSidOverride ?? service.getCallSid?.() ?? "<unknown>",
            vapiCallId: service.getVapiCallId?.() ?? "<unknown>",
            activeSessions: Array.from(this.sessions.keys()),
            mappedCallIds: Array.from(this.sessionsByVapiCallId.keys()),
        };
    }
}
