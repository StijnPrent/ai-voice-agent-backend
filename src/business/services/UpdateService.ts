import {inject, injectable} from "tsyringe";
import {IUpdateRepository} from "../../data/interfaces/IUpdateRepository";
import {UpdateModel} from "../models/UpdateModel";

@injectable()
export class UpdateService {
    constructor(
        @inject("IUpdateRepository") private integrationRepository: IUpdateRepository
    ) {}

    public async fetchUpdates(companyId: bigint): Promise<UpdateModel[]> {
        return this.integrationRepository.fetchUpdates(companyId);
    }
}