import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { inject, injectable } from "tsyringe";
import {
    IAdminRepository,
    ClientDetailRow,
    ClientListRow,
    ClientRecentCallRow,
    ClientWeeklyCallRow,
    InvoiceListRow,
    RevenueHistoryDailyRow,
    RevenueHistoryMonthlyRow,
} from "../../data/interfaces/IAdminRepository";

interface LoginResult {
    token: string;
    user: {
        id: number;
        email: string;
        name: string;
    };
}

interface DashboardMetricsResponse {
    totalCalls: number;
    totalMinutes: number;
    totalCosts: number;
    totalRevenue: number;
    liveCalls: number;
    trends: {
        callsChange: number;
        minutesChange: number;
        costsChange: number;
        revenueChange: number;
    };
}

interface RevenueHistoryMonthlyResponse {
    month: string;
    revenue: number;
}

interface RevenueHistoryDailyResponse {
    day: string;
    revenue: number;
}

interface ClientListResponse {
    id: number;
    name: string;
    email: string;
    phone: string | null;
    twilioNumber: string | null;
    totalCalls: number;
    totalMinutes: number;
    totalCosts: number;
    totalRevenue: number;
}

interface ClientDetailResponse extends ClientListResponse {
    address: string | null;
    joinedDate: string;
}

interface ClientWeeklyHistoryResponse {
    date: string;
    calls: number;
}

interface ClientRecentCallResponse {
    id: number;
    date: string;
    time: string;
    duration: string;
    cost: number;
    revenue: number;
    status: string;
}

interface InvoiceResponse {
    id: string;
    clientId: number;
    clientName: string;
    amount: number;
    status: string;
    date: string;
    dueDate: string | null;
}

interface PricingResponse {
    costPerMinute: number;
    pricePerMinute: number;
}

@injectable()
export class AdminService {
    constructor(
        @inject("IAdminRepository") private readonly repository: IAdminRepository
    ) {}

    public async login(email: string, password: string): Promise<LoginResult | null> {
        const admin = await this.repository.findAdminByEmail(email);
        if (!admin) {
            return null;
        }

        const valid = await bcrypt.compare(password, admin.passwordHash);
        if (!valid) {
            return null;
        }

        const token = jwt.sign(
            { adminId: admin.id },
            process.env.JWT_SECRET as string,
            { expiresIn: "8h" }
        );

        return {
            token,
            user: {
                id: admin.id,
                email: admin.email,
                name: admin.name,
            },
        };
    }

    public async getDashboardMetrics(): Promise<DashboardMetricsResponse> {
        const snapshot = await this.repository.getDashboardSnapshot();
        const totalMinutes = this.toMinutes(snapshot.totalSeconds);
        const currentMinutes = this.toMinutes(snapshot.currentSeconds);
        const previousMinutes = this.toMinutes(snapshot.previousSeconds);

        return {
            totalCalls: snapshot.totalCalls,
            totalMinutes,
            totalCosts: this.roundCurrency(snapshot.totalCosts),
            totalRevenue: this.roundCurrency(snapshot.totalRevenue),
            liveCalls: snapshot.liveCalls,
            trends: {
                callsChange: this.calculateTrend(snapshot.currentCalls, snapshot.previousCalls),
                minutesChange: this.calculateTrend(currentMinutes, previousMinutes),
                costsChange: this.calculateTrend(
                    this.roundCurrency(snapshot.currentCosts),
                    this.roundCurrency(snapshot.previousCosts)
                ),
                revenueChange: this.calculateTrend(
                    this.roundCurrency(snapshot.currentRevenue),
                    this.roundCurrency(snapshot.previousRevenue)
                ),
            },
        };
    }

    public async getRevenueHistoryMonthly(months: number): Promise<RevenueHistoryMonthlyResponse[]> {
        const rows = await this.repository.getRevenueHistoryMonthly(months);
        return rows.map((row: RevenueHistoryMonthlyRow) => ({
            month: row.monthLabel,
            revenue: this.roundCurrency(row.revenue),
        }));
    }

    public async getRevenueHistoryDaily(): Promise<RevenueHistoryDailyResponse[]> {
        const rows = await this.repository.getRevenueHistoryDaily();
        return rows.map((row: RevenueHistoryDailyRow) => ({
            day: row.dayLabel,
            revenue: this.roundCurrency(row.revenue),
        }));
    }

    public async getRecentInvoices(limit: number): Promise<InvoiceResponse[]> {
        const rows = await this.repository.getRecentInvoices(limit);
        return rows.map((row: InvoiceListRow) => ({
            id: row.id,
            clientId: row.clientId,
            clientName: row.clientName,
            amount: this.roundCurrency(row.amount),
            status: row.status,
            date: row.issuedDate,
            dueDate: row.dueDate,
        }));
    }

    public async getClients(): Promise<ClientListResponse[]> {
        const rows = await this.repository.getClients();
        return rows.map((row: ClientListRow) => ({
            id: row.id,
            name: row.name,
            email: row.email,
            phone: row.phone,
            twilioNumber: row.twilioNumber,
            totalCalls: row.totalCalls,
            totalMinutes: this.toMinutes(row.totalSeconds),
            totalCosts: this.roundCurrency(row.totalCosts),
            totalRevenue: this.roundCurrency(row.totalRevenue),
        }));
    }

    public async getClientById(clientId: number): Promise<ClientDetailResponse | null> {
        const row = await this.repository.getClientById(clientId);
        if (!row) {
            return null;
        }

        return {
            id: row.id,
            name: row.name,
            email: row.email,
            phone: row.phone,
            twilioNumber: row.twilioNumber,
            totalCalls: row.totalCalls,
            totalMinutes: this.toMinutes(row.totalSeconds),
            totalCosts: this.roundCurrency(row.totalCosts),
            totalRevenue: this.roundCurrency(row.totalRevenue),
            address: row.address,
            joinedDate: row.joinedDate,
        };
    }

    public async getClientCallHistory(clientId: number, weeks: number): Promise<ClientWeeklyHistoryResponse[]> {
        const rows = await this.repository.getClientWeeklyCallHistory(clientId, weeks);
        return rows.map((row: ClientWeeklyCallRow) => ({
            date: row.weekEndingLabel,
            calls: row.callCount,
        }));
    }

    public async getClientRecentCalls(clientId: number, limit: number): Promise<ClientRecentCallResponse[]> {
        const rows = await this.repository.getClientRecentCalls(clientId, limit);
        return rows.map((row: ClientRecentCallRow) => ({
            id: row.id,
            date: this.formatDate(row.startedAt),
            time: this.formatTime(row.startedAt),
            duration: this.formatDuration(row.durationSeconds ?? 0),
            cost: this.roundCurrency(row.costAmount ?? 0),
            revenue: this.roundCurrency(row.revenueAmount ?? 0),
            status: row.status,
        }));
    }

    public async updateClient(
        clientId: number,
        payload: {
            name: string;
            email: string;
            phone?: string | null;
            twilioNumber?: string | null;
            address?: string | null;
        }
    ): Promise<ClientDetailResponse | null> {
        await this.repository.updateClient(clientId, {
            name: payload.name,
            email: payload.email,
            phone: payload.phone ?? null,
            twilioNumber: payload.twilioNumber ?? null,
            address: payload.address ?? null,
        });

        return this.getClientById(clientId);
    }

    public async updateClientTwilioNumber(
        clientId: number,
        twilioNumber: string | null
    ): Promise<ClientDetailResponse | null> {
        await this.repository.updateClientTwilioNumber(clientId, twilioNumber);
        return this.getClientById(clientId);
    }

    public async getInvoices(status: string | null, search: string | null): Promise<InvoiceResponse[]> {
        const rows = await this.repository.searchInvoices(status, search);
        return rows.map((row: InvoiceListRow) => ({
            id: row.id,
            clientId: row.clientId,
            clientName: row.clientName,
            amount: this.roundCurrency(row.amount),
            status: row.status,
            date: row.issuedDate,
            dueDate: row.dueDate,
        }));
    }

    public async getPricing(): Promise<PricingResponse> {
        const pricing = await this.repository.getPricingSettings();
        if (!pricing) {
            return {
                costPerMinute: 0,
                pricePerMinute: 0,
            };
        }

        return {
            costPerMinute: Number(pricing.costPerMinute),
            pricePerMinute: Number(pricing.pricePerMinute),
        };
    }

    public async updatePricing(costPerMinute: number, pricePerMinute: number): Promise<PricingResponse> {
        const updated = await this.repository.updatePricing(costPerMinute, pricePerMinute);
        return {
            costPerMinute: Number(updated.costPerMinute),
            pricePerMinute: Number(updated.pricePerMinute),
        };
    }

    private toMinutes(seconds: number): number {
        return Number((seconds / 60).toFixed(2));
    }

    private roundCurrency(amount: number): number {
        return Number((amount ?? 0).toFixed(2));
    }

    private calculateTrend(current: number, previous: number): number {
        if (previous === 0) {
            return current > 0 ? 100 : 0;
        }

        const change = ((current - previous) / Math.abs(previous)) * 100;
        return Number(change.toFixed(2));
    }

    private formatDate(date: Date): string {
        return date.toISOString().slice(0, 10);
    }

    private formatTime(date: Date): string {
        return date.toISOString().slice(11, 16);
    }

    private formatDuration(totalSeconds: number): string {
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${this.padNumber(minutes)}:${this.padNumber(seconds)}`;
    }

    private padNumber(value: number): string {
        return value.toString().padStart(2, "0");
    }
}
