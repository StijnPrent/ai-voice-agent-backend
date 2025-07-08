// src/data/interfaces/IPasswordRepository.ts
export interface IPasswordRepository {
    createPassword(companyId: bigint, passwordHash: string): Promise<void>;
    findCurrentPasswordByCompanyId(companyId: bigint): Promise<string | null>;
}
