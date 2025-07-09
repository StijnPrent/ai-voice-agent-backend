import { IIntegrationRepository } from "../../data/interfaces/IIntegrationRepository";
import {inject, injectable} from "tsyringe";
import {IntegrationModel} from "../models/IntegrationModel";

@injectable()
export class IntegrationService {

    constructor(
        @inject("IIntegrationRepository") private integrationRepository: IIntegrationRepository
    ) {}

    async getAllWithStatus(companyId: bigint): Promise<IntegrationModel[]> {
        return this.integrationRepository.getAllWithStatus(companyId);
    }

    public async hasCalendarConnected(companyId: bigint): Promise<boolean> {
        return this.integrationRepository.hasCalendarConnected(companyId);
    }
}