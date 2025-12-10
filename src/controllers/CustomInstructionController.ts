import { Request, Response } from "express";
import { container } from "tsyringe";
import { CustomInstructionService } from "../business/services/CustomInstructionService";

export class CustomInstructionController {
    private service: CustomInstructionService;

    constructor() {
        this.service = container.resolve(CustomInstructionService);
    }

    public async list(req: Request, res: Response) {
        const companyId = BigInt(req.query.companyId as string);
        const items = await this.service.list(companyId);
        res.json(items.map((i) => ({
            id: i.id,
            companyId: i.companyId.toString(),
            instruction: i.instruction,
            createdAt: i.createdAt,
        })));
    }

    public async create(req: Request, res: Response) {
        const companyId = BigInt(req.companyId);
        const instruction = String(req.body.instruction ?? "");
        const id = await this.service.create(companyId, instruction);
        res.status(201).json({ id });
    }

    public async remove(req: Request, res: Response) {
        const companyId = BigInt(req.query.companyId as string);
        const id = Number(req.params.id);
        await this.service.remove(companyId, id);
        res.json({ success: true });
    }
}
