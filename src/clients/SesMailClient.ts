import { SESClient, SendRawEmailCommand } from "@aws-sdk/client-ses";
import { IMailClient, SendMailParams } from "./MailClient";
import config from "../config/config";

function generateBoundary(prefix: string) {
  return `${prefix}-${Math.random().toString(16).slice(2)}-${Date.now()}`;
}

function toBase64(input: Buffer): string {
  return input.toString("base64");
}

function stripHtml(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export class SesMailClient implements IMailClient {
  private client: SESClient;
  private defaultFrom: string;

  constructor() {
    this.client = new SESClient({ region: process.env.SES_REGION || (config as any).sesRegion || process.env.AWS_REGION });
    this.defaultFrom = process.env.SES_FROM || (config as any).sesFrom || "info@callingbird.nl";
  }

  async send(params: SendMailParams): Promise<{ id?: string }> {
    const from = params.from || this.defaultFrom;
    const to = params.to;
    const subject = params.subject || "";
    const htmlBody = params.htmlBody || "";
    const textBody = params.textBody || stripHtml(htmlBody);

    const mixedBoundary = generateBoundary("mixed");
    const altBoundary = generateBoundary("alt");

    const lines: string[] = [];
    lines.push("From: " + from);
    lines.push("To: " + to);
    lines.push("Subject: " + subject);
    lines.push("MIME-Version: 1.0");

    if (params.attachments && params.attachments.length > 0) {
      lines.push(`Content-Type: multipart/mixed; boundary=\"${mixedBoundary}\"`);
      lines.push("");
      // Start alternative part inside mixed
      lines.push(`--${mixedBoundary}`);
      lines.push(`Content-Type: multipart/alternative; boundary=\"${altBoundary}\"`);
      lines.push("");

      // text part
      lines.push(`--${altBoundary}`);
      lines.push("Content-Type: text/plain; charset=UTF-8");
      lines.push("Content-Transfer-Encoding: 7bit");
      lines.push("");
      lines.push(textBody);
      lines.push("");

      // html part
      lines.push(`--${altBoundary}`);
      lines.push("Content-Type: text/html; charset=UTF-8");
      lines.push("Content-Transfer-Encoding: 7bit");
      lines.push("");
      lines.push(htmlBody);
      lines.push("");

      // End alternative
      lines.push(`--${altBoundary}--`);

      // Attachments
      for (const att of params.attachments) {
        const filename = att.filename || "attachment";
        const contentType = att.contentType || "application/octet-stream";
        const contentB64 = toBase64(att.content);
        lines.push("");
        lines.push(`--${mixedBoundary}`);
        lines.push(`Content-Type: ${contentType}; name=\"${filename}\"`);
        lines.push("Content-Transfer-Encoding: base64");
        lines.push(`Content-Disposition: attachment; filename=\"${filename}\"`);
        lines.push("");
        // Split base64 to 76-char lines as per RFC
        for (let i = 0; i < contentB64.length; i += 76) {
          lines.push(contentB64.slice(i, i + 76));
        }
      }

      // End mixed
      lines.push("");
      lines.push(`--${mixedBoundary}--`);
    } else {
      // No attachments → simple alternative
      lines.push(`Content-Type: multipart/alternative; boundary=\"${altBoundary}\"`);
      lines.push("");
      lines.push(`--${altBoundary}`);
      lines.push("Content-Type: text/plain; charset=UTF-8");
      lines.push("Content-Transfer-Encoding: 7bit");
      lines.push("");
      lines.push(textBody);
      lines.push("");
      lines.push(`--${altBoundary}`);
      lines.push("Content-Type: text/html; charset=UTF-8");
      lines.push("Content-Transfer-Encoding: 7bit");
      lines.push("");
      lines.push(htmlBody);
      lines.push("");
      lines.push(`--${altBoundary}--`);
    }

    const raw = lines.join("\r\n");
    const command = new SendRawEmailCommand({
      RawMessage: { Data: Buffer.from(raw) },
    });
    const resp = await this.client.send(command);
    return { id: resp.MessageId };
  }
}

