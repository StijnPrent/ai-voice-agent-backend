import { inject, injectable } from "tsyringe";
import { workerIdentity } from "../../config/workerIdentity";
import type { VapiAssistantConfig } from "../../clients/VapiClient";
import {
  IVapiSessionRepository,
  UpsertVapiSessionInput,
  VapiSessionRecord,
} from "../../data/interfaces/IVapiSessionRepository";

export type { VapiSessionRecord } from "../../data/interfaces/IVapiSessionRepository";

type RegisterSessionInput = {
  callId: string;
  callSid?: string | null;
  workerId: string;
  workerAddress?: string | null;
  ttlSeconds?: number;
  config?: VapiAssistantConfig | null;
};

@injectable()
export class VapiSessionRegistry {
  private readonly defaultTtlSeconds = 5 * 60; // 5 minutes

  constructor(
    @inject("IVapiSessionRepository") private readonly repository: IVapiSessionRepository,
  ) {
    void this.initialize();
  }

  public async registerSession(input: RegisterSessionInput): Promise<void> {
    const callId = input.callId?.trim();
    const workerId = input.workerId?.trim();

    if (!callId || !workerId) {
      return;
    }

    const ttlSeconds = input.ttlSeconds ?? this.defaultTtlSeconds;
    const expiresAt = ttlSeconds > 0 ? new Date(Date.now() + ttlSeconds * 1000) : null;

    const configJson = this.serializeConfig(callId, input.config);

    const record: UpsertVapiSessionInput = {
      callId,
      callSid: input.callSid?.trim() || null,
      workerId,
      workerAddress: input.workerAddress?.trim() || null,
      expiresAt,
      configJson,
    };

    try {
      await this.repository.deleteExpiredSessions();
      await this.repository.upsertSession(record);
    } catch (error) {
      console.error("[VapiSessionRegistry] Failed to register session", {
        callId,
        workerId,
        workerAddress: record.workerAddress ?? "<none>",
        error,
      });
    }
  }

  public async unregisterSession(callIdInput: string): Promise<void> {
    const callId = callIdInput?.trim();
    if (!callId) {
      return;
    }

    try {
      await this.repository.deleteSession(callId);
    } catch (error) {
      console.error("[VapiSessionRegistry] Failed to unregister session", { callId, error });
    }
  }

  public async findSession(callIdInput: string | null | undefined): Promise<VapiSessionRecord | null> {
    const callId = callIdInput?.trim();
    if (!callId) {
      return null;
    }

    try {
      await this.repository.deleteExpiredSessions();
      return await this.repository.findSession(callId);
    } catch (error) {
      console.error("[VapiSessionRegistry] Failed to find session", { callId, error });
      return null;
    }
  }

  public async clearWorkerSessions(workerIdInput: string): Promise<void> {
    const workerId = workerIdInput?.trim();
    if (!workerId) {
      return;
    }

    try {
      await this.repository.clearWorkerSessions(workerId);
    } catch (error) {
      console.error("[VapiSessionRegistry] Failed to clear worker sessions", { workerId, error });
    }
  }

  private async initialize(): Promise<void> {
    try {
      await this.repository.ensureInitialized();
      await this.repository.deleteExpiredSessions();
      await this.repository.clearWorkerSessions(workerIdentity.id);
    } catch (error) {
      console.error("[VapiSessionRegistry] Failed to initialize", error);
    }
  }

  private serializeConfig(
    callId: string,
    config: VapiAssistantConfig | null | undefined,
  ): string | null {
    if (typeof config === 'undefined') {
      return null;
    }

    if (config === null) {
      return null;
    }

    try {
      return JSON.stringify(config, (_key, value) =>
        typeof value === 'bigint' ? value.toString() : value,
      );
    } catch (error) {
      console.error('[VapiSessionRegistry] Failed to serialize session config', { callId, error });
      return null;
    }
  }
}
