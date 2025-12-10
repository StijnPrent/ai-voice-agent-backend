import { CustomInstructionModel } from "../../business/models/CustomInstructionModel";

export interface ICustomInstructionRepository {
    getByCompany(companyId: bigint): Promise<CustomInstructionModel[]>;
    add(companyId: bigint, instruction: string): Promise<number>;
    delete(companyId: bigint, id: number): Promise<void>;
}
