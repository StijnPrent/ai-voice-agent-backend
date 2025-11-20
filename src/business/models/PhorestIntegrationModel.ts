export class PhorestIntegrationModel {
    constructor(
        public readonly id: number,
        public readonly companyId: bigint,
        public readonly businessId: string,
        public readonly branchId: string,
        public readonly username: string,
        public readonly encryptedPassword: string,
        public readonly passwordIv: string,
        public readonly passwordTag: string,
        public readonly createdAt?: Date,
        public readonly updatedAt?: Date
    ) {}
}
