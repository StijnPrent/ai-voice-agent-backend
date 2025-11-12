import { Request, Response } from "express";
import { container } from "tsyringe";
import { AdminService } from "../business/services/AdminService";
import { MailService } from "../business/services/MailService";

export class AdminController {
    private get service(): AdminService {
        return container.resolve(AdminService);
    }

    private get mail(): MailService {
        return container.resolve(MailService);
    }

    private handleError(res: Response, error: unknown, message: string): void {
        console.error(error);
        res.status(500).json({ success: false, error: message });
    }

    public async login(req: Request, res: Response): Promise<void> {
        try {
            const { email, password } = req.body ?? {};
            if (!email || !password) {
                res.status(400).json({ success: false, error: "Email and password are required." });
                return;
            }

            const result = await this.service.login(String(email), String(password));
            if (!result) {
                res.status(401).json({ success: false, error: "Invalid email or password." });
                return;
            }

            res.json({ token: result.token, user: result.user });
        } catch (error) {
            this.handleError(res, error, "Failed to login");
        }
    }

    public async getDashboardMetrics(req: Request, res: Response): Promise<void> {
        try {
            const metrics = await this.service.getDashboardMetrics();
            res.json(metrics);
        } catch (error) {
            this.handleError(res, error, "Failed to fetch dashboard metrics");
        }
    }

    public async getRevenueHistory(req: Request, res: Response): Promise<void> {
        try {
            const period = String(req.query.period ?? "monthly");
            if (period === "monthly") {
                const monthsParam = Number(req.query.months ?? 6);
                const months = Number.isFinite(monthsParam) ? Math.max(1, Math.floor(monthsParam)) : 6;
                const history = await this.service.getRevenueHistoryMonthly(months);
                res.json(history);
                return;
            }

            if (period === "daily") {
                const history = await this.service.getRevenueHistoryDaily();
                res.json(history);
                return;
            }

            res.status(400).json({ success: false, error: "Invalid period. Use 'monthly' or 'daily'." });
        } catch (error) {
            this.handleError(res, error, "Failed to fetch revenue history");
        }
    }

    public async getRecentInvoices(req: Request, res: Response): Promise<void> {
        try {
            const limitParam = Number(req.query.limit ?? 6);
            const limit = Number.isFinite(limitParam) ? Math.max(1, Math.floor(limitParam)) : 6;
            const invoices = await this.service.getRecentInvoices(limit);
            res.json(invoices);
        } catch (error) {
            this.handleError(res, error, "Failed to fetch recent invoices");
        }
    }

    public async getClients(req: Request, res: Response): Promise<void> {
        try {
            const clients = await this.service.getClients();
            res.json(clients);
        } catch (error) {
            this.handleError(res, error, "Failed to fetch clients");
        }
    }

    public async getClient(req: Request, res: Response): Promise<void> {
        try {
            const clientId = Number(req.params.id);
            if (!Number.isFinite(clientId)) {
                res.status(400).json({ success: false, error: "Invalid client id." });
                return;
            }

            const client = await this.service.getClientById(clientId);
            if (!client) {
                res.status(404).json({ success: false, error: "Client not found." });
                return;
            }

            res.json(client);
        } catch (error) {
            this.handleError(res, error, "Failed to fetch client");
        }
    }

    public async getClientCallHistory(req: Request, res: Response): Promise<void> {
        try {
            const clientId = Number(req.params.id);
            const weeksParam = Number(req.query.weeks ?? 6);
            if (!Number.isFinite(clientId)) {
                res.status(400).json({ success: false, error: "Invalid client id." });
                return;
            }

            const weeks = Number.isFinite(weeksParam) ? Math.max(1, Math.floor(weeksParam)) : 6;
            const history = await this.service.getClientCallHistory(clientId, weeks);
            res.json(history);
        } catch (error) {
            this.handleError(res, error, "Failed to fetch client call history");
        }
    }

    public async getClientRecentCalls(req: Request, res: Response): Promise<void> {
        try {
            const clientId = Number(req.params.id);
            const limitParam = Number(req.query.limit ?? 5);
            if (!Number.isFinite(clientId)) {
                res.status(400).json({ success: false, error: "Invalid client id." });
                return;
            }

            const limit = Number.isFinite(limitParam) ? Math.max(1, Math.floor(limitParam)) : 5;
            const calls = await this.service.getClientRecentCalls(clientId, limit);
            res.json(calls);
        } catch (error) {
            this.handleError(res, error, "Failed to fetch recent client calls");
        }
    }

    public async updateClient(req: Request, res: Response): Promise<void> {
        try {
            const clientId = Number(req.params.id);
            if (!Number.isFinite(clientId)) {
                res.status(400).json({ success: false, error: "Invalid client id." });
                return;
            }

            const { name, email, phone, twilioNumber, address } = req.body ?? {};
            if (!name || !email) {
                res.status(400).json({ success: false, error: "Name and email are required." });
                return;
            }

            const client = await this.service.updateClient(clientId, {
                name: String(name),
                email: String(email),
                phone: phone !== undefined && phone !== null ? String(phone) : null,
                twilioNumber:
                    twilioNumber !== undefined && twilioNumber !== null
                        ? String(twilioNumber)
                        : null,
                address: address !== undefined && address !== null ? String(address) : null,
            });

            if (!client) {
                res.status(404).json({ success: false, error: "Client not found." });
                return;
            }

            res.json({ success: true, client });
        } catch (error) {
            this.handleError(res, error, "Failed to update client");
        }
    }

    public async updateClientTwilioNumber(req: Request, res: Response): Promise<void> {
        try {
            const clientId = Number(req.params.id);
            const { twilioNumber } = req.body ?? {};
            if (!Number.isFinite(clientId)) {
                res.status(400).json({ success: false, error: "Invalid client id." });
                return;
            }

            const client = await this.service.updateClientTwilioNumber(
                clientId,
                twilioNumber !== undefined && twilioNumber !== null
                    ? String(twilioNumber)
                    : null
            );

            if (!client) {
                res.status(404).json({ success: false, error: "Client not found." });
                return;
            }

            res.json({ success: true, twilioNumber: client.twilioNumber });
        } catch (error) {
            this.handleError(res, error, "Failed to update client Twilio number");
        }
    }

    public async getInvoices(req: Request, res: Response): Promise<void> {
        try {
            const status = req.query.status ? String(req.query.status) : null;
            const search = req.query.search ? String(req.query.search) : null;
            const invoices = await this.service.getInvoices(status, search);
            res.json(invoices);
        } catch (error) {
            this.handleError(res, error, "Failed to fetch invoices");
        }
    }

    public async getPricing(req: Request, res: Response): Promise<void> {
        try {
            const pricing = await this.service.getPricing();
            res.json(pricing);
        } catch (error) {
            this.handleError(res, error, "Failed to fetch pricing settings");
        }
    }

    public async updatePricing(req: Request, res: Response): Promise<void> {
        try {
            const { costPerMinute, pricePerMinute } = req.body ?? {};
            if (costPerMinute === undefined || pricePerMinute === undefined) {
                res.status(400).json({ success: false, error: "costPerMinute and pricePerMinute are required." });
                return;
            }

            const cost = Number(costPerMinute);
            const price = Number(pricePerMinute);
            if (!Number.isFinite(cost) || !Number.isFinite(price) || cost < 0 || price < 0) {
                res.status(400).json({ success: false, error: "Invalid pricing values." });
                return;
            }

            const pricing = await this.service.updatePricing(cost, price);
            res.json({ success: true, pricing });
        } catch (error) {
            this.handleError(res, error, "Failed to update pricing settings");
        }
    }

    // Mail template: GET current
    public async getMailTemplate(req: Request, res: Response): Promise<void> {
        try {
            const tpl = await this.mail.getTemplate();
            res.json({
                subject: tpl.subject,
                body: tpl.body,
                placeholders: ["email", "company", "contactName"],
            });
        } catch (error) {
            this.handleError(res, error, "Failed to fetch mail template");
        }
    }

    // Mail template: PUT update
    public async updateMailTemplate(req: Request, res: Response): Promise<void> {
        try {
            const { subject, body } = req.body ?? {};
            if (typeof subject !== "string" || typeof body !== "string") {
                res.status(400).json({ success: false, error: "subject and body are required" });
                return;
            }
            const updated = await this.mail.updateTemplate(subject, body);
            res.json({ success: true, template: updated });
        } catch (error) {
            this.handleError(res, error, "Failed to update mail template");
        }
    }

    // Send email, optionally with body/subject override from preview
    public async sendAdminMail(req: Request, res: Response): Promise<void> {
        try {
            const { to, email, company, contactName, bodyOverride, subjectOverride } = req.body ?? {};
            if (!to || typeof to !== "string") {
                res.status(400).json({ success: false, error: "'to' is required" });
                return;
            }

            const result = await this.mail.sendAdminEmail({
                to: String(to),
                email: email ? String(email) : null,
                company: company ? String(company) : null,
                contactName: contactName ? String(contactName) : null,
                bodyOverride: bodyOverride ? String(bodyOverride) : null,
                subjectOverride: subjectOverride ? String(subjectOverride) : null,
            });

            res.json({ success: true, id: result.id });
        } catch (error) {
            this.handleError(res, error, "Failed to send email");
        }
    }
}
