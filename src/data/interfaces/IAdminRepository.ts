import { PricingSettings } from "../../business/models/PricingSettings";

export interface AdminUserRecord {
    id: number;
    email: string;
    passwordHash: string;
    name: string;
}

export interface DashboardSnapshotRecord {
    totalCalls: number;
    totalSeconds: number;
    totalCosts: number;
    totalRevenue: number;
    liveCalls: number;
    currentCalls: number;
    currentSeconds: number;
    currentCosts: number;
    currentRevenue: number;
    previousCalls: number;
    previousSeconds: number;
    previousCosts: number;
    previousRevenue: number;
}

export interface RevenueHistoryMonthlyRow {
    monthLabel: string;
    revenue: number;
}

export interface RevenueHistoryDailyRow {
    dayLabel: string;
    revenue: number;
}

export interface InvoiceListRow {
    id: string;
    clientId: number;
    clientName: string;
    amount: number;
    status: string;
    issuedDate: string;
    dueDate: string | null;
}

export interface ClientListRow {
    id: number;
    name: string;
    email: string;
    phone: string | null;
    twilioNumber: string | null;
    totalCalls: number;
    totalSeconds: number;
    totalCosts: number;
    totalRevenue: number;
}

export interface ClientDetailRow {
    id: number;
    name: string;
    email: string;
    phone: string | null;
    twilioNumber: string | null;
    address: string | null;
    totalCalls: number;
    totalSeconds: number;
    totalCosts: number;
    totalRevenue: number;
    joinedDate: string;
}

export interface ClientWeeklyCallRow {
    weekEndingLabel: string;
    callCount: number;
}

export interface ClientRecentCallRow {
    id: number;
    startedAt: Date;
    durationSeconds: number | null;
    costAmount: number | null;
    revenueAmount: number | null;
    status: string;
}

export interface IAdminRepository {
    findAdminByEmail(email: string): Promise<AdminUserRecord | null>;
    getPricingSettings(): Promise<PricingSettings | null>;
    getDashboardSnapshot(): Promise<DashboardSnapshotRecord>;
    getRevenueHistoryMonthly(months: number): Promise<RevenueHistoryMonthlyRow[]>;
    getRevenueHistoryDaily(): Promise<RevenueHistoryDailyRow[]>;
    getRecentInvoices(limit: number): Promise<InvoiceListRow[]>;
    getClients(): Promise<ClientListRow[]>;
    getClientById(clientId: number): Promise<ClientDetailRow | null>;
    getClientWeeklyCallHistory(clientId: number, weeks: number): Promise<ClientWeeklyCallRow[]>;
    getClientRecentCalls(clientId: number, limit: number): Promise<ClientRecentCallRow[]>;
    updateClient(
        clientId: number,
        payload: {
            name: string;
            email: string;
            phone: string | null;
            twilioNumber: string | null;
            address: string | null;
        }
    ): Promise<void>;
    updateClientTwilioNumber(clientId: number, twilioNumber: string | null): Promise<void>;
    searchInvoices(status: string | null, search: string | null): Promise<InvoiceListRow[]>;
    updatePricing(costPerMinute: number, pricePerMinute: number): Promise<PricingSettings>;
}
