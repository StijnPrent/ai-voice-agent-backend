import { Request, Response } from "express";
import { container } from "tsyringe";
import { BillingService } from "../business/services/BillingService";

export class BillingController {
    private get service(): BillingService {
        return container.resolve(BillingService);
    }

    public async landingSignup(req: Request, res: Response): Promise<void> {
        try {
            const {
                companyName,
                contactName,
                email,
                password,
                accessCode,
                iban,
                accountHolderName,
                pricePerMinute,
            } = req.body ?? {};

            if (!companyName || !email || !password || !iban || !accountHolderName) {
                res.status(400).json({
                    message: "companyName, email, password, iban and accountHolderName are required.",
                });
                return;
            }

            const parsedPrice =
                pricePerMinute !== undefined && pricePerMinute !== null
                    ? Number(pricePerMinute)
                    : undefined;
            const result = await this.service.createLandingSignup({
                companyName: String(companyName),
                contactName: contactName ? String(contactName) : undefined,
                email: String(email),
                password: String(password),
                accessCode: accessCode ? String(accessCode) : undefined,
                iban: String(iban).replace(/\s+/g, ""),
                accountHolderName: String(accountHolderName),
                pricePerMinute: Number.isFinite(parsedPrice) ? (parsedPrice as number) : undefined,
            });

            res.status(201).json({
                message: "Account created, trial started and mandate set up.",
                ...result,
            });
        } catch (error) {
            console.error("[BillingController] landingSignup error", error);
            res.status(500).json({ message: "Failed to start trial checkout." });
        }
    }

    public async runMonthlyBilling(req: Request, res: Response): Promise<void> {
        try {
            const monthRaw =
                req.body?.month !== undefined ? Number(req.body.month) : req.query?.month ? Number(req.query.month) : undefined;
            const yearRaw =
                req.body?.year !== undefined ? Number(req.body.year) : req.query?.year ? Number(req.query.year) : undefined;
            const month = Number.isFinite(monthRaw) ? monthRaw : undefined;
            const year = Number.isFinite(yearRaw) ? yearRaw : undefined;
            const result = await this.service.runMonthlyBilling({ month, year });
            res.json(result);
        } catch (error) {
            console.error("[BillingController] runMonthlyBilling error", error);
            res.status(500).json({ message: "Failed to run monthly billing." });
        }
    }

    public async getInvoice(req: Request, res: Response): Promise<void> {
        try {
            const invoiceNumber = String(req.params.invoiceNumber ?? "").trim();
            if (!invoiceNumber) {
                res.status(400).json({ message: "invoiceNumber is required." });
                return;
            }
            const invoice = await this.service.getInvoice(invoiceNumber);
            if (!invoice) {
                res.status(404).json({ message: "Invoice not found." });
                return;
            }
            res.json({
                ...invoice,
                companyId: invoice.companyId.toString(),
            });
        } catch (error) {
            console.error("[BillingController] getInvoice error", error);
            res.status(500).json({ message: "Failed to fetch invoice." });
        }
    }

    public async mollieWebhook(req: Request, res: Response): Promise<void> {
        const paymentId = (req.body?.id as string) || (req.body?.paymentId as string);
        if (!paymentId) {
            res.status(400).json({ message: "Missing payment id." });
            return;
        }
        try {
            await this.service.handleMollieWebhook(paymentId);
            res.status(200).send("ok");
        } catch (error) {
            console.error("[BillingController] webhook error", error);
            res.status(500).json({ message: "Failed to process webhook." });
        }
    }
}
