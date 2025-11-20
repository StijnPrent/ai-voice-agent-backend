export interface SendMailParams {
  to: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
  from?: string;
  replyTo?: string | string[];
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType?: string;
  }>;
}

export interface IMailClient {
  send(params: SendMailParams): Promise<{ id?: string }>;
}
