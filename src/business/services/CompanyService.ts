import { injectable, inject } from "tsyringe";
import { calendar_v3 } from "googleapis";
import { ICompanyRepository } from "../../data/interfaces/ICompanyRepository";
import { CompanyModel } from "../models/CompanyModel";
import { CompanyInfoModel } from "../models/CompanyInfoModel";
import crypto from "crypto";

@injectable()
export class CompanyService {
    constructor(
        @inject("ICompanyRepository") private repo: ICompanyRepository
    ) {}

    // Company CRUD
    async create(name: string, twilioNumber: string, website: string): Promise<void> {
        const bytes = crypto.randomBytes(8); // 8 bytes = 64-bit
        const sanitizedTwilioNumber = twilioNumber.replace(/\s+/g, "");
        const id = BigInt("0x" + bytes.toString("hex"));
        const company = new CompanyModel(
            id,
            name,
            sanitizedTwilioNumber,
            website,
            false,
            new Date(),
            new Date()
        )
        await this.repo.createCompany(company);
    }

    async findByTwilioNumber(twilioNumber: string): Promise<CompanyModel> {
        const sanitizedTwilioNumber = twilioNumber.replace(/\s+/g, "");
        const company = await this.repo.findByTwilioNumber(sanitizedTwilioNumber);
        if (!company) {
            throw new Error("Unknown company");
        }
        return company;
    }

    async setCalendarConnected(companyId: bigint, connected: boolean): Promise<void> {
        await this.repo.setCalendarConnected(companyId, connected);
    }

    // Info list operations
    async addInfo(companyId: bigint, value: string): Promise<void> {
        await this.repo.addInfo(companyId, value);
    }

    async removeInfo(infoId: number): Promise<void> {
        await this.repo.removeInfo(infoId);
    }

    async getCompanyInfo(companyId: bigint): Promise<CompanyInfoModel[]> {
        return this.repo.fetchInfo(companyId);
    }

    // Appointment parsing
    async parseAppointment(text: string): Promise<calendar_v3.Schema$Event> {
        const match = /([0-9]{4}-[0-9]{2}-[0-9]{2})\\s+([0-9]{2}:[0-9]{2})/.exec(text);
        if (!match) throw new Error("Could not parse date/time");
        const [_, date, time] = match;
        const start = new Date(`${date}T${time}:00`);
        const end   = new Date(start.getTime() + 60*60*1000);
        return {
            summary: "Appointment",
            start: { dateTime: start.toISOString() },
            end:   { dateTime: end.toISOString() }
        };
    }
}