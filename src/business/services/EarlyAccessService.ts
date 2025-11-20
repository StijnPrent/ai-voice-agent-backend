import { inject, injectable } from "tsyringe";
import { IEarlyAccessRepository } from "../../data/interfaces/IEarlyAccessRepository";
import { TransactionalMailService } from "./TransactionalMailService";

export interface EarlyAccessPayload {
  email: string;
  name?: string | null;
  company?: string | null;
}

@injectable()
export class EarlyAccessService {
  constructor(
    @inject("IEarlyAccessRepository") private readonly repository: IEarlyAccessRepository,
    private readonly transactionalMail: TransactionalMailService
  ) {}

  public async submitRequest(payload: EarlyAccessPayload): Promise<void> {
    await this.repository.createRequest({
      email: payload.email,
      name: payload.name ?? null,
      company: payload.company ?? null,
    });

    await this.transactionalMail.sendEarlyAccessConfirmation({
      to: payload.email,
      name: payload.name,
      company: payload.company,
    });
  }

  public async cancelRequestByEmail(email: string): Promise<boolean> {
    if (!email?.trim()) {
      throw new Error("Email is required.");
    }
    return this.repository.deleteByEmail(email.trim());
  }
}
