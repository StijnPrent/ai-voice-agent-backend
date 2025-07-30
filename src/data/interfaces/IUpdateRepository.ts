import {UpdateModel} from "../../business/models/UpdateModel";

export interface IUpdateRepository {
    fetchUpdates(companyId: bigint): Promise<UpdateModel[]>;
}