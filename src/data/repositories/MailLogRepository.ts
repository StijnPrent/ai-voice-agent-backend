import { BaseRepository } from "./BaseRepository";
import { CreateMailLogParams, IMailLogRepository } from "../interfaces/IMailLogRepository";

export class MailLogRepository extends BaseRepository implements IMailLogRepository {
  public async createLog(params: CreateMailLogParams): Promise<void> {
    const sql = `
      INSERT INTO mail_messages
        (mail_type, template_name, recipient, subject, payload, provider_message_id, status, error_message, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `;

    await this.execute(sql, [
      params.type,
      params.template,
      params.to,
      params.subject,
      params.payload ? JSON.stringify(params.payload) : null,
      params.providerMessageId ?? null,
      params.status,
      params.error ?? null,
    ]);
  }
}
