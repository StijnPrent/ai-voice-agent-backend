export class CustomInstructionModel {
    constructor(
        public readonly id: number,
        public readonly companyId: bigint,
        public readonly instruction: string,
        public readonly createdAt: Date | null = null,
    ) {}
}
