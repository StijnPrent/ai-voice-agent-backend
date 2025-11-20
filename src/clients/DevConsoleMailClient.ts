import { IMailClient, SendMailParams } from "./MailClient";

export class DevConsoleMailClient implements IMailClient {
  async send(params: SendMailParams): Promise<{ id?: string }> {
    const { to, subject, htmlBody, textBody, from, replyTo, attachments } = params;
    // In development/default, just log the email payload
    console.log("[DevConsoleMailClient] send:", {
      to,
      from,
      replyTo,
      subject,
      htmlLength: htmlBody?.length ?? 0,
      textLength: textBody?.length ?? 0,
      attachments: attachments?.map(a => ({ filename: a.filename, size: a.content?.length ?? 0, contentType: a.contentType })) ?? [],
    });
    return { id: `dev-${Date.now()}` };
  }
}
