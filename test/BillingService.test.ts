import { BillingService } from "../src/business/services/BillingService";
import { BillingProfileRecord, InvoiceRecord } from "../src/data/interfaces/IBillingRepository";
import { IUsageRepository } from "../src/data/interfaces/IUsageRepository";
import { IAdminRepository } from "../src/data/interfaces/IAdminRepository";

// Mock Mollie client so no network calls occur.
const createPaymentMock = jest.fn().mockResolvedValue({
    id: "pay_test_1",
    status: "paid",
    _links: {},
});

jest.mock("../src/clients/MollieClient", () => {
    return {
        MollieClient: jest.fn().mockImplementation(() => ({
            createPayment: createPaymentMock,
            createCustomer: jest.fn(),
            createMandate: jest.fn(),
            getPayment: jest.fn(),
        })),
    };
});

describe("BillingService anniversary billing", () => {
    beforeAll(() => {
        process.env.MOLLIE_API_KEY = process.env.MOLLIE_API_KEY || "test-mollie-key";
    });

    it("creates an invoice for the first monthly cycle based on signup date", async () => {
        const profile: BillingProfileRecord = {
            companyId: BigInt(1),
            email: "owner@acme.test",
            companyName: "Acme",
            companyCreatedAt: new Date("2024-01-15T00:00:00Z"),
            pricePerMinute: null, // will fall back to global pricing
            status: "active",
            trialEndsAt: null,
            mollieCustomerId: "cst_test",
            mollieMandateId: "mdt_test",
            lastBilledMonth: null,
        };

        // Mocks for dependencies
        const billingRepo = {
            getBillableCompanies: jest.fn().mockResolvedValue([profile]),
            getLastInvoiceForCompany: jest.fn().mockResolvedValue(null),
            upsertBillingProfile: jest.fn(),
            createInvoice: jest.fn().mockImplementation((input) => {
                const invoice: InvoiceRecord = {
                    invoiceNumber: input.invoiceNumber,
                    companyId: input.companyId,
                    amount: input.amount,
                    currency: input.currency ?? "EUR",
                    status: input.status,
                    issuedDate: input.issuedDate,
                    dueDate: input.dueDate ?? null,
                    usageSeconds: input.usageSeconds ?? null,
                    pricePerMinute: input.pricePerMinute ?? null,
                    paymentId: input.paymentId ?? null,
                    paymentLink: input.paymentLink ?? null,
                    metadata: input.metadata ?? null,
                    periodStart: input.periodStart ?? null,
                    periodEnd: input.periodEnd ?? null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                };
                return Promise.resolve(invoice);
            }),
            getInvoiceByNumber: jest.fn(),
            findInvoiceByPaymentId: jest.fn(),
            updateInvoiceStatus: jest.fn(),
            markCompanyLastBilled: jest.fn(),
        };

        const usageRepo: IUsageRepository = {
            recordCall: jest.fn(),
            incrementMonthlyUsage: jest.fn(),
            getUsageForMonth: jest.fn(),
            getUsageBetween: jest.fn().mockResolvedValue(600), // 10 minutes
        };

        const adminRepo: Partial<IAdminRepository> = {
            getPricingSettings: jest.fn().mockResolvedValue({ costPerMinute: 0, pricePerMinute: 0.5, updatedAt: new Date() }),
        };

        const transactionalMail = {
            sendInvoiceIssued: jest.fn().mockResolvedValue(undefined),
            sendInvoicePaid: jest.fn().mockResolvedValue(undefined),
            sendTrialStarted: jest.fn().mockResolvedValue(undefined),
        };

        const companyService = {} as any;

        const service = new BillingService(
            billingRepo as any,
            usageRepo,
            adminRepo as any,
            transactionalMail as any,
            companyService
        );

        // Run billing as of end of March to ensure the first cycle (Jan15->Feb15) is due.
        const result = await service.runMonthlyBilling({ month: 3, year: 2024 });

        expect(billingRepo.getBillableCompanies).toHaveBeenCalled();
        expect(usageRepo.getUsageBetween).toHaveBeenCalledWith(
            profile.companyId,
            profile.companyCreatedAt,
            new Date("2024-02-15T00:00:00.000Z")
        );
        expect(createPaymentMock).toHaveBeenCalled();
        expect(billingRepo.createInvoice).toHaveBeenCalled();
        expect(billingRepo.markCompanyLastBilled).toHaveBeenCalledWith(
            profile.companyId,
            profile.companyCreatedAt
        );
        expect(transactionalMail.sendInvoiceIssued).toHaveBeenCalledWith(
            expect.objectContaining({
                to: profile.email,
                invoiceNumber: expect.any(String),
                amount: 5, // 10 minutes * 0.5 EUR
            })
        );
        expect(result.invoicesCreated).toBe(1);
        expect(result.invoices[0]).toEqual(
            expect.objectContaining({
                companyId: profile.companyId.toString(),
                amount: 5,
                status: "paid",
            })
        );
    });
});
