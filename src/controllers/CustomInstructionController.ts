import { Request, Response } from "express";
import { container } from "tsyringe";
import { CustomInstructionService } from "../business/services/CustomInstructionService";

export class CustomInstructionController {
    private service: CustomInstructionService;

    constructor() {
        this.service = container.resolve(CustomInstructionService);
    }

    public async list(req: Request, res: Response): Promise<void> {
        const companyIdRaw = (req.query['companyId'] ?? req.body?.companyId) as string | undefined;
        if (!companyIdRaw) {
            res.status(400).json({ error: "companyId is required" });
            return;
        }
        const companyId = BigInt(companyIdRaw);
        const items = await this.service.list(companyId);
        res.json(items.map((i) => ({
            id: i.id,
            companyId: i.companyId.toString(),
            instruction: i.instruction,
            createdAt: i.createdAt,
        })));
    }

    public async create(req: Request, res: Response): Promise<void> {
        const companyIdRaw = (req.body?.companyId ?? req.query['companyId']) as string | undefined;
        if (!companyIdRaw) {
            res.status(400).json({ error: "companyId is required" });
            return;
        }
        const companyId = BigInt(companyIdRaw);
        const instruction = String(req.body.instruction ?? "");
        const id = await this.service.create(companyId, instruction);
        res.status(201).json({ id });
    }

    public async remove(req: Request, res: Response): Promise<void> {
        const companyIdRaw = (req.query['companyId'] ?? req.body?.companyId) as string | undefined;
        if (!companyIdRaw) {
            res.status(400).json({ error: "companyId is required" });
            return;
        }
        const companyId = BigInt(companyIdRaw);
        const id = Number(req.params.id);
        await this.service.remove(companyId, id);
        res.json({ success: true });
    }
}
