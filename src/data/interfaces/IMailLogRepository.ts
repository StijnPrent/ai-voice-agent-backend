export type MailStatus = "sent" | "failed";

export interface CreateMailLogParams {
  type: string;
  template: string;
  to: string;
  subject: string;
  payload?: Record<string, any> | null;
  providerMessageId?: string | null;
  status: MailStatus;
  error?: string | null;
}

export interface IMailLogRepository {
  createLog(params: CreateMailLogParams): Promise<void>;
}
