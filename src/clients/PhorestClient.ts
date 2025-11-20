import axios, { AxiosInstance } from "axios";
import { injectable } from "tsyringe";
import config from "../config/config";

export type PhorestAuth = {
    username: string;
    password: string;
};

export type PhorestClientOptions = {
    baseUrl?: string;
    timeoutMs?: number;
};

@injectable()
export class PhorestClient {
    private readonly http: AxiosInstance;

    constructor() {
        const baseUrl = config.phorestBaseUrl ?? "http://api-gateway-eu.phorest.com/third-party-api-server";

        this.http = axios.create({
            baseURL: baseUrl.replace(/\/$/, ""),
            timeout: 10000,
        });
    }

    async getAppointments(params: {
        businessId: string;
        branchId: string;
        auth: PhorestAuth;
        query?: Record<string, unknown>;
    }): Promise<any> {
        const { businessId, branchId, auth, query } = params;
        const url = this.buildAppointmentPath(businessId, branchId);
        const response = await this.http.get(url, {
            params: query,
            headers: this.buildHeaders(auth),
        });
        return response.data;
    }

    async confirmAppointments(params: {
        businessId: string;
        branchId: string;
        auth: PhorestAuth;
        clientId: string;
        date: string;
        payload?: Record<string, unknown>;
    }): Promise<any> {
        const { businessId, branchId, auth, clientId, date, payload } = params;
        const url = this.buildAppointmentPath(businessId, branchId, "/confirm");
        const body = {
            client_id: clientId,
            date,
            ...(payload ?? {}),
        };
        const response = await this.http.post(url, body, {
            headers: this.buildHeaders(auth),
        });
        return response.data;
    }

    async cancelAppointments(params: {
        businessId: string;
        branchId: string;
        auth: PhorestAuth;
        appointmentIds: string[];
        payload?: Record<string, unknown>;
    }): Promise<any> {
        const { businessId, branchId, auth, appointmentIds, payload } = params;
        const url = this.buildAppointmentPath(businessId, branchId, "/cancel");
        const body = {
            appointment_id: appointmentIds,
            ...(payload ?? {}),
        };
        const response = await this.http.post(url, body, {
            headers: this.buildHeaders(auth),
        });
        return response.data;
    }

    async checkAppointmentAvailability(params: {
        businessId: string;
        branchId: string;
        auth: PhorestAuth;
        payload: Record<string, unknown>;
    }): Promise<any> {
        const { businessId, branchId, auth, payload } = params;
        const url = this.buildAppointmentPath(businessId, branchId, "/availability/check");
        const response = await this.http.post(url, payload, {
            headers: this.buildHeaders(auth),
        });
        return response.data;
    }

    async createAppointment(params: {
        businessId: string;
        branchId: string;
        auth: PhorestAuth;
        appointment: Record<string, unknown>;
    }): Promise<any> {
        const { businessId, branchId, auth, appointment } = params;
        const url = this.buildAppointmentPath(businessId, branchId);
        const response = await this.http.post(url, appointment, {
            headers: this.buildHeaders(auth),
        });
        return response.data;
    }

    async getClients(params: {
        businessId: string;
        auth: PhorestAuth;
        query?: Record<string, unknown>;
    }): Promise<any> {
        const { businessId, auth, query } = params;
        const url = `/api/business/${encodeURIComponent(businessId)}/client`;
        const response = await this.http.get(url, {
            headers: this.buildHeaders(auth),
            params: query,
        });
        return response.data;
    }

    async createClient(params: {
        businessId: string;
        auth: PhorestAuth;
        payload: Record<string, unknown>;
    }): Promise<any> {
        const { businessId, auth, payload } = params;
        const url = `/api/business/${encodeURIComponent(businessId)}/client`;
        const response = await this.http.post(url, payload, {
            headers: this.buildHeaders(auth),
        });
        return response.data;
    }

    async getStaffList(params: {
        businessId: string;
        branchId: string;
        auth: PhorestAuth;
        query?: Record<string, unknown>;
    }): Promise<any> {
        const { businessId, branchId, auth, query } = params;
        const url = `/api/business/${encodeURIComponent(businessId)}/branch/${encodeURIComponent(
            branchId
        )}/staff`;
        const response = await this.http.get(url, {
            headers: this.buildHeaders(auth),
            params: query,
        });
        return response.data;
    }

    private buildAppointmentPath(businessId: string, branchId: string, suffix = ""): string {
        const normalizedSuffix = suffix.startsWith("/") ? suffix : `/${suffix}`;
        const sanitizedSuffix = suffix ? normalizedSuffix : "";
        return `/api/business/${encodeURIComponent(businessId)}/branch/${encodeURIComponent(
            branchId
        )}/appointment${sanitizedSuffix}`;
    }

    private buildHeaders(auth: PhorestAuth) {
        const token = Buffer.from(`${auth.username}:${auth.password}`).toString("base64");
        return {
            Authorization: `Basic ${token}`,
        };
    }
}
