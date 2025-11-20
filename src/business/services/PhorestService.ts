import { inject, injectable } from "tsyringe";
import { PhorestClient } from "../../clients/PhorestClient";
import { IPhorestRepository } from "../../data/interfaces/IPhorestRepository";
import { encrypt, decrypt } from "../../utils/crypto";
import { PhorestIntegrationModel } from "../models/PhorestIntegrationModel";

export type PhorestAppointment = {
    id: string;
    appointmentDate: string;
    startTime: string;
    endTime: string;
    clientId?: string | null;
    staffId?: string | null;
    state?: string | null;
    notes?: string | null;
};

type ConnectInput = {
    businessId: string;
    branchId: string;
    username: string;
    password: string;
};

type ConfirmAppointmentsInput = {
    clientId: string;
    date: string;
    payload?: Record<string, unknown>;
};

type CancelAppointmentsInput = {
    appointmentIds: string[];
    payload?: Record<string, unknown>;
};

type CreateAppointmentInput = {
    appointmentDate: string;
    startTime: string;
    endTime: string;
    clientId: string;
    staffId?: string | null;
    serviceId?: string | null;
    notes?: string | null;
    metadata?: Record<string, unknown>;
};

type CheckAvailabilityInput = {
    clientId: string;
    startTime: string;
    endTime: string;
    clientServiceSelections: Record<string, unknown>[];
    rescheduleBookingId?: string | null;
    isOnlineAvailability?: boolean;
};

@injectable()
export class PhorestService {
    constructor(
        @inject("IPhorestRepository") private readonly repo: IPhorestRepository,
        @inject(PhorestClient) private readonly client: PhorestClient
    ) {}

    async connect(companyId: bigint, input: ConnectInput): Promise<void> {
        const businessId = this.normalize(input.businessId);
        const branchId = this.normalize(input.branchId);
        const username = this.normalize(input.username);
        const password = input.password?.trim();

        if (!businessId || !branchId || !username || !password) {
            throw new Error("Business ID, branch ID, username and password are required.");
        }

        const encrypted = encrypt(password);
        await this.repo.upsertIntegration(
            companyId,
            businessId,
            branchId,
            username,
            encrypted.data,
            encrypted.iv,
            encrypted.tag
        );
    }

    async disconnect(companyId: bigint): Promise<void> {
        await this.repo.deleteIntegration(companyId);
    }

    async getAppointments(
        companyId: bigint,
        query?: Record<string, unknown>
    ): Promise<PhorestAppointment[]> {
        const integration = await this.getIntegration(companyId);
        const data = await this.client.getAppointments({
            businessId: integration.businessId,
            branchId: integration.branchId,
            auth: this.buildAuth(integration),
            query,
        });
        const appointments =
            data &&
            data._embedded &&
            Array.isArray((data._embedded as any).appointments)
                ? (data._embedded as any).appointments
                : [];
        return appointments
            .filter((item: any): item is Record<string, any> => typeof item?.appointmentId === "string")
            .map((item: any): PhorestAppointment => ({
                id: item.appointmentId,
                appointmentDate: item.appointmentDate ?? item.appointment_date ?? "",
                startTime: item.startTime ?? item.start_time ?? "",
                endTime: item.endTime ?? item.end_time ?? item.startTime ?? item.start_time ?? "",
                clientId: item.clientId ?? item.client_id ?? null,
                staffId: item.staffId ?? item.staff_id ?? null,
                state: item.state ?? null,
                notes: item.notes ?? null,
            }));
    }

    async confirmAppointments(
        companyId: bigint,
        input: ConfirmAppointmentsInput
    ): Promise<any> {
        const integration = await this.getIntegration(companyId);
        if (!input.clientId?.trim() || !input.date?.trim()) {
            throw new Error("clientId and date are required to confirm appointments.");
        }

        return this.client.confirmAppointments({
            businessId: integration.businessId,
            branchId: integration.branchId,
            auth: this.buildAuth(integration),
            clientId: input.clientId.trim(),
            date: input.date.trim(),
            payload: input.payload,
        });
    }

    async cancelAppointments(
        companyId: bigint,
        input: CancelAppointmentsInput
    ): Promise<any> {
        const integration = await this.getIntegration(companyId);
        const appointmentIds = (input.appointmentIds ?? [])
            .map((id) => id?.trim())
            .filter((id): id is string => Boolean(id));

        if (appointmentIds.length === 0) {
            throw new Error("At least one appointment ID is required to cancel appointments.");
        }

        return this.client.cancelAppointments({
            businessId: integration.businessId,
            branchId: integration.branchId,
            auth: this.buildAuth(integration),
            appointmentIds,
            payload: input.payload,
        });
    }

    async createAppointment(
        companyId: bigint,
        input: CreateAppointmentInput
    ): Promise<any> {
        const integration = await this.getIntegration(companyId);
        const payload = this.stripUndefined({
            appointmentDate: input.appointmentDate,
            appointment_date: input.appointmentDate,
            startTime: input.startTime,
            start_time: input.startTime,
            endTime: input.endTime,
            end_time: input.endTime,
            clientId: input.clientId,
            client_id: input.clientId,
            staffId: input.staffId ?? undefined,
            staff_id: input.staffId ?? undefined,
            serviceId: input.serviceId ?? undefined,
            service_id: input.serviceId ?? undefined,
            notes: input.notes ?? undefined,
            ...(input.metadata ?? {}),
        });

        return this.client.createAppointment({
            businessId: integration.businessId,
            branchId: integration.branchId,
            auth: this.buildAuth(integration),
            appointment: payload,
        });
    }

    async checkAvailability(
        companyId: bigint,
        input: CheckAvailabilityInput
    ): Promise<any[]> {
        const integration = await this.getIntegration(companyId);
        const payload = this.stripUndefined({
            clientId: input.clientId,
            startTime: input.startTime,
            endTime: input.endTime,
            clientServiceSelections: input.clientServiceSelections,
            rescheduleBookingId: input.rescheduleBookingId ?? undefined,
            isOnlineAvailability: input.isOnlineAvailability ?? undefined,
        });
        const response = await this.client.checkAppointmentAvailability({
            businessId: integration.businessId,
            branchId: integration.branchId,
            auth: this.buildAuth(integration),
            payload,
        });
        if (!response) {
            return [];
        }
        if (Array.isArray(response.data)) {
            return response.data;
        }
        if (Array.isArray(response._embedded?.data)) {
            return response._embedded.data;
        }
        if (Array.isArray(response._embedded?.appointments)) {
            return response._embedded.appointments;
        }
        if (Array.isArray(response?.results)) {
            return response.results;
        }
        return [];
    }

    async listStaffMembers(
        companyId: bigint,
        query?: Record<string, unknown>
    ): Promise<any[]> {
        const integration = await this.getIntegration(companyId);
        const response = await this.client.getStaffList({
            businessId: integration.businessId,
            branchId: integration.branchId,
            auth: this.buildAuth(integration),
            query,
        });
        const embedded = response?._embedded;
        if (embedded && Array.isArray(embedded.staffs)) {
            return embedded.staffs;
        }
        if (Array.isArray(response?.data)) {
            return response.data;
        }
        return [];
    }

    async findClientByPhone(companyId: bigint, phone: string): Promise<any | null> {
        const normalizedPhone = this.normalizePhone(phone);
        if (!normalizedPhone) {
            return null;
        }
        const integration = await this.getIntegration(companyId);
        const response = await this.client.getClients({
            businessId: integration.businessId,
            auth: this.buildAuth(integration),
            query: { phone: normalizedPhone },
        });
        const embedded = response?._embedded;
        if (embedded && Array.isArray(embedded.clients) && embedded.clients.length > 0) {
            return embedded.clients[0];
        }
        if (Array.isArray(response?.data) && response.data.length > 0) {
            return response.data[0];
        }
        return null;
    }

    async createClient(companyId: bigint, payload: { firstName: string; lastName: string; phone: string; email?: string | null }): Promise<any> {
        const integration = await this.getIntegration(companyId);
        const body = this.stripUndefined({
            firstName: payload.firstName || "Onbekend",
            lastName: payload.lastName || "Onbekend",
            mobile: this.normalizePhone(payload.phone),
            email: payload.email ?? undefined,
        });
        return this.client.createClient({
            businessId: integration.businessId,
            auth: this.buildAuth(integration),
            payload: body,
        });
    }

    async getOrCreateClientByPhone(
        companyId: bigint,
        details: { phone: string; firstName?: string | null; lastName?: string | null; email?: string | null }
    ): Promise<any> {
        const existing = await this.findClientByPhone(companyId, details.phone);
        if (existing) {
            return existing;
        }
        return this.createClient(companyId, {
            firstName: details.firstName ?? "Onbekend",
            lastName: details.lastName ?? "Onbekend",
            phone: details.phone,
            email: details.email ?? null,
        });
    }

    private async getIntegration(companyId: bigint): Promise<PhorestIntegrationModel> {
        const integration = await this.repo.fetchIntegration(companyId);
        if (!integration) {
            throw new Error("Phorest integration not configured for this company.");
        }
        return integration;
    }

    private buildAuth(model: PhorestIntegrationModel) {
        const password = decrypt(model.encryptedPassword, model.passwordIv, model.passwordTag);
        return {
            username: model.username,
            password,
        };
    }

    private normalize(value: string | undefined | null): string {
        if (typeof value !== "string") {
            return "";
        }
        return value.trim();
    }

    private normalizePhone(value: string | undefined | null): string | null {
        if (typeof value !== "string") {
            return null;
        }
        const trimmed = value.trim();
        if (!trimmed) {
            return null;
        }
        return trimmed.replace(/\s+/g, "");
    }

    private stripUndefined<T extends Record<string, unknown>>(value: T): T {
        const entries = Object.entries(value).filter(([, v]) => v !== undefined);
        return Object.fromEntries(entries) as T;
    }
}
