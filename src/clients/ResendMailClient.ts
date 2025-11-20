import { Resend } from "resend";
import { IMailClient, SendMailParams } from "./MailClient";
import config from "../config/config";

export class ResendMailClient implements IMailClient {
  private client: Resend;
  private readonly defaultFrom: string;
  private readonly defaultReplyTo?: string;

  constructor() {
    const apiKey = process.env.RESEND_API_KEY || (config as any).resendApiKey;
    if (!apiKey) {
      throw new Error("Missing Resend API key. Set RESEND_API_KEY in the environment.");
    }

    this.client = new Resend(apiKey);
    this.defaultFrom =
      process.env.RESEND_FROM ||
      (config as any).resendFrom ||
      process.env.SES_FROM ||
      (config as any).sesFrom ||
      "info@callingbird.nl";
    this.defaultReplyTo =
      process.env.RESEND_REPLY_TO || (config as any).resendReplyTo || undefined;
  }

  async send(params: SendMailParams): Promise<{ id?: string }> {
    const from = params.from || this.defaultFrom;
    const replyTo = params.replyTo || this.defaultReplyTo;
    const attachments =
      params.attachments && params.attachments.length > 0
        ? params.attachments.map((att) => ({
            filename: att.filename,
            content: att.content,
            contentType: att.contentType,
          }))
        : undefined;

    const response = await this.client.emails.send({
      from,
      to: params.to,
      subject: params.subject,
      html: params.htmlBody,
      text: params.textBody,
      replyTo: replyTo,
      attachments,
    });

    const messageId =
      (response as any)?.id ??
      (response as any)?.data?.id ??
      undefined;

    return { id: messageId };
  }
}
