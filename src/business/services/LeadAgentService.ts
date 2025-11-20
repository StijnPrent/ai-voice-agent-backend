import { injectable } from "tsyringe";
import { runLeadWorkflow } from "../../agents/leadAgentWorkflow";
import { ValidationError } from "../errors/ValidationError";

@injectable()
export class LeadAgentService {
    public async runLeadWorkflow(prompt: unknown) {
        const validatedPrompt = this.ensurePrompt(prompt);
        return runLeadWorkflow({ input_as_text: validatedPrompt });
    }

    private ensurePrompt(value: unknown): string {
        if (typeof value !== "string" || !value.trim()) {
            throw new ValidationError("'prompt' is required.");
        }
        return value.trim();
    }
}
