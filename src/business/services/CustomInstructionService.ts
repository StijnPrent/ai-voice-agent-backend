import "reflect-metadata";
import { inject, injectable } from "tsyringe";
import { ICustomInstructionRepository } from "../../data/interfaces/ICustomInstructionRepository";
import { CustomInstructionModel } from "../models/CustomInstructionModel";

@injectable()
export class CustomInstructionService {
    constructor(
        @inject("ICustomInstructionRepository") private readonly repo: ICustomInstructionRepository
    ) {}

    public async list(companyId: bigint): Promise<CustomInstructionModel[]> {
        return this.repo.getByCompany(companyId);
    }

    public async create(companyId: bigint, instruction: string): Promise<number> {
        const trimmed = (instruction ?? "").trim();
        if (!trimmed) {
            throw new Error("Instruction cannot be empty");
        }
        return this.repo.add(companyId, trimmed);
    }

    public async remove(companyId: bigint, id: number): Promise<void> {
        await this.repo.delete(companyId, id);
    }
}
