import createMollieClient, {
    Mandate,
    MandateMethod,
    Payment,
    PaymentMethod,
    SequenceType,
} from "@mollie/api-client";
import config from "../config/config";

type MollieApiClient = ReturnType<typeof createMollieClient>;

export interface CreateMolliePaymentInput {
    amount: number;
    currency?: string;
    description: string;
    customerId: string;
    mandateId?: string | null;
    sequenceType?: SequenceType;
    redirectUrl?: string;
    webhookUrl?: string;
    metadata?: Record<string, any>;
    dueDate?: string;
}

export class MollieClient {
    private client: MollieApiClient;

    constructor(apiKey: string | undefined = process.env.MOLLIE_API_KEY) {
        if (!apiKey) {
            throw new Error("Missing MOLLIE_API_KEY");
        }
        this.client = createMollieClient({ apiKey });
    }

    public async createCustomer(params: { name: string; email: string }) {
        return this.client.customers.create({
            name: params.name,
            email: params.email,
        });
    }

    public async createMandate(params: {
        customerId: string;
        consumerName: string;
        consumerAccount: string;
        signatureDate?: string;
        mandateReference?: string;
    }): Promise<Mandate> {
        const today = new Date();
        return this.client.customerMandates.create({
            customerId: params.customerId,
            method: MandateMethod.directdebit,
            consumerName: params.consumerName,
            consumerAccount: params.consumerAccount,
            signatureDate: params.signatureDate ?? today.toISOString().slice(0, 10),
            mandateReference: params.mandateReference,
        });
    }

    public async createPayment(input: CreateMolliePaymentInput): Promise<Payment> {
        const amount = Number.isFinite(input.amount) ? Math.max(0, input.amount) : 0;
        const formattedAmount = amount.toFixed(2);
        const webhookUrl =
            input.webhookUrl || `${config.serverUrl.replace(/\/+$/, "")}/billing/webhooks/mollie`;
        return this.client.payments.create({
            amount: {
                value: formattedAmount,
                currency: input.currency ?? "EUR",
            },
            description: input.description,
            method: PaymentMethod.directdebit,
            customerId: input.customerId,
            mandateId: input.mandateId ?? undefined,
            sequenceType: input.sequenceType ?? SequenceType.recurring,
            redirectUrl: input.redirectUrl ?? `${config.frontendUrl}/billing/confirmation`,
            webhookUrl,
            metadata: input.metadata,
            dueDate: input.dueDate,
        });
    }

    public async getPayment(paymentId: string): Promise<Payment> {
        return this.client.payments.get(paymentId);
    }
}
