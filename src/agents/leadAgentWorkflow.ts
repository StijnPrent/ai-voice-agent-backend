import {
    Agent,
    AgentInputItem,
    Runner,
    hostedMcpTool,
    webSearchTool,
    withTrace,
} from "@openai/agents";

/**
 * Hosted MCP configuration. The URL can be overridden via LEADS_MCP_URL or falls
 * back to the current API server so the Agent can reach the leads tools locally.
 */
const defaultMcpUrl = `${process.env.SERVER_URL ?? "http://localhost:3002"}/mcp/leads`;
const leadsMcpUrl = process.env.LEADS_MCP_URL ?? defaultMcpUrl;

const webSearchPreview = webSearchTool({
    userLocation: {
        type: "approximate",
        country: undefined,
        region: undefined,
        city: undefined,
        timezone: undefined,
    },
    searchContextSize: "medium",
});

const mcp = hostedMcpTool({
    serverLabel: "lead_server",
    serverUrl: leadsMcpUrl,
    allowedTools: ["leads_get_all", "leads_append_many"],
    requireApproval: "never",
});

const leadAgent = new Agent({
    name: "lead agent",
    instructions: `Je bent een lead research assistent voor CallingBird.

DOEL:
- Jij zoekt nieuwe leads (bijvoorbeeld kappers, salons, tandartsen, etc.) via internet.
- Je gebruikt de MCP-database (pipeline_company) als permanente opslag voor leads.
- Je voegt alleen nieuwe, unieke leads toe (nooit dubbelen).
- Er wordt GEEN categorie gebruikt.

BELANGRIJKE MCP-TOOLS:
- leads_get_all: haalt alle bestaande leads (pipeline_company) uit de database.
- leads_append_many: voegt een lijst nieuwe leads toe aan de database.

VELDEN PER LEAD (afgestemd op pipeline_company):
- naam    → company.name
- telefoon → company.phone
- website (optioneel) → company.website
- adres (optioneel) → company.address
- plaats (optioneel) → company.city

WERKWIJZE:

1. Begrijp eerst de opdracht van de gebruiker:
   - type bedrijf (bijv. kapper, nagelsalon)
   - locatie (bijv. Leiden, Amsterdam)
   - gewenst aantal nieuwe leads (bijv. 5, 10, 20).
   De gebruiker kan dit kort formuleren zoals: “10 kappers in Leiden”.

2. Haal ALTIJD eerst de bestaande leads op:
   - Roep MCP-tool \`leads_get_all\` aan.
   - Sla het resultaat op als \`existing_leads\`.
   - Gebruik deze velden voor unieke herkenning:
       - (naam + plaats) OF
       - (telefoon + website)
     Als één van deze combinaties matcht → beschouwen als duplicaat.

3. Zoek nieuwe leads via Web search:
   - Gebruik zoekopdrachten zoals:
      “{bedrijfstype} {plaats} telefoonnummer”
      “kapsalon Leiden”
   - Open bedrijfswebsites, Google Maps-detailpagina’s en bedrijvengidsen.
   - Verzamel per gevonden bedrijf:
       - naam (verplicht)
       - telefoon (verplicht indien zichtbaar)
       - website (optioneel)
       - adres (optioneel)
       - plaats (optioneel)

4. Filter op unieke leads:
   - Controleer elke gevonden lead tegen \`existing_leads\`.
   - Als deze al bestaat → sla over.
   - Als deze nog niet bestaat → voeg toe aan \`new_leads\`.

5. Opslaan in database:
   - Roep MCP-tool \`leads_append_many\` precies ÉÉN keer aan, met als argument
     een object met één property \`leads\`.
   - \`leads\` MOET een array zijn van lead-objecten.
   - De structuur van de aanroep moet er zo uitzien (let op de Engelse veldnamen):

     {
       "leads": [
         {
           "name": "...",
           "phone": "...",
           "website": "...",
           "address": "...",
           "city": "...",
           "phaseId": 1
         },
         ...
       ]
     }

   - Gebruik altijd deze veldnamen: \`name\`, \`phone\`, \`website\`, \`address\`, \`city\`, \`phaseId\`.
   - Zorg dat alle nieuwe leads samen in één array worden verstuurd; maak niet
     meerdere losse calls per lead.

6. Output naar de gebruiker:
   - Geef alleen de NIEUWE leads uit deze run als tabel terug.
   - Gebruik velden:
       Naam | Telefoon | Website | Adres | Plaats
   - Geen extra tekst erbij.

7. Verzint NOOIT telefoon, website, adres of plaats.
   - Als iets niet gevonden wordt: laat de cel leeg.`,
    model: "gpt-5.1-chat-latest",
    tools: [webSearchPreview, mcp],
    modelSettings: {
        temperature: 1,
        topP: 1,
        maxTokens: 2048,
        store: true,
    },
});

export type LeadWorkflowInput = { input_as_text: string };
export type LeadWorkflowResult = { output_text: string };

export async function runLeadWorkflow(
    workflowInput: LeadWorkflowInput
): Promise<LeadWorkflowResult> {
    return withTrace("Lead magnet", async () => {
        const conversationHistory: AgentInputItem[] = [
            {
                role: "user",
                content: [{ type: "input_text", text: workflowInput.input_as_text }],
            },
        ];

        const runner = new Runner({
            traceMetadata: {
                __trace_source__: "agent-builder",
                workflow_id: "wf_691d9f0b0a448190a1a961e01e709ac00309647301ce1645",
            },
        });

        const leadAgentResultTemp = await runner.run(leadAgent, [...conversationHistory]);
        conversationHistory.push(
            ...leadAgentResultTemp.newItems.map((item) => item.rawItem)
        );

        if (!leadAgentResultTemp.finalOutput) {
            throw new Error("Agent result is undefined");
        }

        return {
            output_text: leadAgentResultTemp.finalOutput,
        };
    });
}
