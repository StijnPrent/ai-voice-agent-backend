import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/spec.types.js";
import { z } from "zod";
import { container } from "tsyringe";
import type { ISalesPipelineRepository } from "../data/interfaces/ISalesPipelineRepository";
import type { PipelineCompanySummaryModel } from "../business/models/PipelineCompanySummaryModel";

const agentLeadSchema = z.object({
    id: z.number(),
    name: z.string(),
    owner: z.string().nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    address: z.string().nullable(),
    city: z.string().nullable(),
    website: z.string().nullable(),
    phaseId: z.number().nullable(),
});

const appendInputSchema = z.object({
    leads: z
        .array(
            z.object({
                name: z
                    .string()
                    .refine((value) => !!value.trim(), "name is required"),
                phone: z
                    .string()
                    .refine((value) => !!value.trim(), "phone is required"),
                email: z.string().optional().nullable(),
                address: z.string().optional().nullable(),
                city: z.string().optional().nullable(),
                website: z.string().optional().nullable(),
                owner: z.string().optional().nullable(),
                phaseId: z.union([z.number().int(), z.string(), z.null()]).optional(),
            })
        )
        .min(1, "At least one lead is required"),
});

type AppendInput = z.infer<typeof appendInputSchema>;
type NormalizedIncomingLead = {
    name: string;
    phone: string;
    email: string | null;
    address: string | null;
    city: string | null;
    website: string | null;
    owner: string | null;
    phaseId: number | null;
};

type AgentLead = z.infer<typeof agentLeadSchema>;

type DedupIndex = {
    nameCity: Set<string>;
    phoneWebsite: Set<string>;
};

type AppendResultPayload = {
    inserted: AgentLead[];
    skipped: { lead: NormalizedIncomingLead; reason: string }[];
};

export function registerLeadTools(server: McpServer): void {
    // Tool: leads_get_all
    // Input: no arguments
    // Output: { leads: AgentLead[] } sorted by repository defaults (updated_at DESC, id DESC)
    server.registerTool(
        "leads_get_all",
        {
            title: "Fetch all pipeline leads",
            description:
                "Lists every pipeline_company row so the agent can reason over the current lead inventory.",
            outputSchema: z.object({
                leads: z.array(agentLeadSchema),
            }),
        },
        async () => {
            try {
                const repository = resolveRepository();
                const companies = await repository.listCompanies();
                const leads = companies.map((company) => mapCompanyToLead(company));
                return buildToolResult({ leads });
            } catch (error) {
                console.error("leads_get_all failed", error);
                return buildErrorResult("Unable to load leads.");
            }
        }
    );

    // Tool: leads_append_many
    // Input: { leads: NormalizedIncomingLead[] } with the minimal fields (name, phone) required.
    // Output: { inserted: AgentLead[], skipped: { lead, reason }[] }
    server.registerTool(
        "leads_append_many",
        {
            title: "Insert multiple leads",
            description:
                "Validates, de-duplicates and inserts new leads into pipeline_company via SalesPipelineRepository.",
            inputSchema: appendInputSchema,
            outputSchema: z.object({
                inserted: z.array(agentLeadSchema),
                skipped: z.array(
                    z.object({
                        lead: z.object({
                            name: z.string(),
                            phone: z.string(),
                            email: z.string().nullable(),
                            address: z.string().nullable(),
                            city: z.string().nullable(),
                            website: z.string().nullable(),
                            owner: z.string().nullable(),
                            phaseId: z.number().nullable(),
                        }),
                        reason: z.string(),
                    })
                ),
            }),
        },
        async (args) => {
            try {
                const parsed = appendInputSchema.parse(args);
                const normalizedLeads = parsed.leads.map((lead) =>
                    normalizeIncomingLead(lead)
                );
                const repository = resolveRepository();
                const existingCompanies = await repository.listCompanies();
                const index = buildDedupIndex(existingCompanies);
                const response: AppendResultPayload = {
                    inserted: [],
                    skipped: [],
                };

                for (const lead of normalizedLeads) {
                    const duplicateReason = findDuplicateReason(index, lead);
                    if (duplicateReason) {
                        response.skipped.push({ lead, reason: duplicateReason });
                        continue;
                    }

                    const created = await repository.createCompany({
                        name: lead.name,
                        owner: lead.owner,
                        phone: lead.phone,
                        email: lead.email,
                        address: lead.address,
                        city: lead.city,
                        website: lead.website,
                        phaseId: lead.phaseId,
                    });
                    response.inserted.push(mapCompanyToLead(created));
                    addCompanyToIndex(index, created);
                }

                return buildToolResult(response);
            } catch (error) {
                console.error("leads_append_many failed", error);
                return buildErrorResult(
                    error instanceof Error ? error.message : "Failed to insert leads."
                );
            }
        }
    );
}

function resolveRepository(): ISalesPipelineRepository {
    return container.resolve<ISalesPipelineRepository>(
        "ISalesPipelineRepository"
    );
}

function buildToolResult<T extends Record<string, unknown>>(payload: T): CallToolResult {
    return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
    };
}

function buildErrorResult(message: string): CallToolResult {
    return {
        content: [{ type: "text", text: message }],
        structuredContent: { error: message },
        isError: true,
    };
}

function mapCompanyToLead(company: PipelineCompanySummaryModel): AgentLead {
    return {
        id: company.id,
        name: company.name,
        owner: company.owner,
        phone: company.phone,
        email: company.email,
        address: company.address,
        city: company.city,
        website: company.website,
        phaseId: company.phaseId,
    };
}

function normalizeIncomingLead(lead: AppendInput["leads"][number]): NormalizedIncomingLead {
    const sanitizeString = (value: string | null | undefined): string | null => {
        if (typeof value !== "string") {
            return null;
        }
        const trimmed = value.trim();
        return trimmed.length ? trimmed : null;
    };

    return {
        name: lead.name.trim(),
        phone: lead.phone.trim(),
        email: sanitizeString(lead.email ?? null),
        address: sanitizeString(lead.address ?? null),
        city: sanitizeString(lead.city ?? null),
        website: sanitizeString(lead.website ?? null),
        owner: sanitizeString(lead.owner ?? null),
        phaseId: normalizePhaseId(lead.phaseId),
    };
}

function normalizePhaseId(phaseId: AppendInput["leads"][number]["phaseId"]): number | null {
    if (phaseId === null || typeof phaseId === "undefined") {
        return null;
    }
    if (typeof phaseId === "number" && Number.isInteger(phaseId)) {
        return phaseId;
    }
    if (typeof phaseId === "string" && phaseId.trim() !== "") {
        const parsed = Number(phaseId);
        return Number.isInteger(parsed) ? parsed : null;
    }
    return null;
}

function buildDedupIndex(companies: PipelineCompanySummaryModel[]): DedupIndex {
    const index: DedupIndex = {
        nameCity: new Set<string>(),
        phoneWebsite: new Set<string>(),
    };
    companies.forEach((company) => addCompanyToIndex(index, company));
    return index;
}

function addCompanyToIndex(
    index: DedupIndex,
    company: PipelineCompanySummaryModel
): void {
    const nameCityKey = createNameCityKey(company.name, company.city);
    if (nameCityKey) {
        index.nameCity.add(nameCityKey);
    }
    const phoneWebsiteKey = createPhoneWebsiteKey(company.phone, company.website);
    if (phoneWebsiteKey) {
        index.phoneWebsite.add(phoneWebsiteKey);
    }
}

function findDuplicateReason(index: DedupIndex, lead: NormalizedIncomingLead): string | null {
    const nameCityKey = createNameCityKey(lead.name, lead.city);
    if (nameCityKey && index.nameCity.has(nameCityKey)) {
        return "duplicate:name+city";
    }
    const phoneWebsiteKey = createPhoneWebsiteKey(lead.phone, lead.website);
    if (phoneWebsiteKey && index.phoneWebsite.has(phoneWebsiteKey)) {
        return lead.website ? "duplicate:phone+website" : "duplicate:phone";
    }
    return null;
}

function createNameCityKey(name?: string | null, city?: string | null): string | null {
    const normalizedName = normalizeText(name);
    const normalizedCity = normalizeText(city);
    if (!normalizedName || !normalizedCity) {
        return null;
    }
    return `name:${normalizedName}|city:${normalizedCity}`;
}

function createPhoneWebsiteKey(
    phone?: string | null,
    website?: string | null
): string | null {
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) {
        return null;
    }
    const normalizedWebsite = normalizeWebsite(website);
    return normalizedWebsite
        ? `phone:${normalizedPhone}|website:${normalizedWebsite}`
        : `phone:${normalizedPhone}`;
}

function normalizeText(value?: string | null): string | null {
    if (!value) {
        return null;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed.toLowerCase() : null;
}

function normalizePhone(value?: string | null): string | null {
    if (!value) {
        return null;
    }
    const digitsOnly = value.replace(/\D+/g, "");
    return digitsOnly.length ? digitsOnly : null;
}

function normalizeWebsite(value?: string | null): string | null {
    if (!value) {
        return null;
    }
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) {
        return null;
    }
    const withoutProtocol = trimmed.replace(/^https?:\/\//, "");
    return withoutProtocol.replace(/\/$/, "");
}
