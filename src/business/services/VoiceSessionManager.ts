import { container, injectable, singleton } from "tsyringe";
import { VoiceService } from "./VoiceService";

@singleton()
@injectable()
export class VoiceSessionManager {
    private readonly sessions = new Map<string, VoiceService>();

    /**
     * Create a new VoiceService instance for the provided callSid and keep
     * track of it so other parts of the system (transfer endpoints,
     * Twilio status callbacks, etc.) can interact with the correct call
     * state while multiple calls are active simultaneously.
     */
    public createSession(callSid: string): VoiceService {
        const voiceService = container.resolve(VoiceService);
        const originalStop = voiceService.stopStreaming.bind(voiceService);

        voiceService.stopStreaming = ((reason?: string) => {
            try {
                originalStop(reason);
            } finally {
                this.releaseSession(callSid, voiceService);
            }
        }) as typeof voiceService.stopStreaming;

        this.sessions.set(callSid, voiceService);
        return voiceService;
    }

    /**
     * Retrieve the VoiceService instance associated with a callSid.
     */
    public getSession(callSid: string | undefined | null): VoiceService | undefined {
        if (!callSid) {
            return undefined;
        }

        return this.sessions.get(callSid);
    }

    /**
     * Resolve an active session when the callSid is optional. If the caller
     * does not provide a callSid we only return a session when there is a
     * single active call to avoid ambiguity.
     */
    public resolveActiveSession(callSid?: string | null): VoiceService | undefined {
        if (callSid) {
            return this.sessions.get(callSid);
        }

        if (this.sessions.size === 1) {
            for (const service of this.sessions.values()) {
                return service;
            }
        }

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

        if (!voiceService || existing === voiceService) {
            this.sessions.delete(callSid);
        }
    }

    /**
     * Return the list of active call identifiers. Helpful for logging when a
     * request cannot be resolved to a specific call.
     */
    public listActiveCallSids(): string[] {
        return Array.from(this.sessions.keys());
    }
}
