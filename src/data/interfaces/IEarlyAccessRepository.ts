export interface CreateEarlyAccessRequest {
  email: string;
  name?: string | null;
  company?: string | null;
}

export interface IEarlyAccessRepository {
  createRequest(params: CreateEarlyAccessRequest): Promise<number>;
  deleteByEmail(email: string): Promise<boolean>;
}
