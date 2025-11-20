import { inject, injectable } from "tsyringe";
import { IMailClient } from "../../clients/MailClient";
import { MailTemplateService } from "./MailTemplateService";
import { promises as fs } from "fs";
import path from "path";
import config from "../../config/config";

export interface SendAdminEmailInput {
  to: string;
  company?: string | null;
  contactName?: string | null;
  email?: string | null; // sender or support email to include in template
  subjectOverride?: string | null; // optional subject override from preview
  bodyOverride?: string | null; // full HTML override from preview
}

@injectable()
export class MailService {
  constructor(
    @inject("IMailClient") private readonly mailClient: IMailClient,
    private readonly templateService: MailTemplateService
  ) {}

  public async getTemplate() {
    return this.templateService.getTemplate();
  }

  public async updateTemplate(subject: string, body: string) {
    return this.templateService.updateTemplate({ subject, body });
  }

  public async sendAdminEmail(input: SendAdminEmailInput) {
    const { to, company, contactName, email, subjectOverride, bodyOverride } = input;

    let subject: string;
    let htmlBody: string;

    if (bodyOverride || subjectOverride) {
      // If frontend provided edited preview, use it directly
      const base = await this.templateService.getTemplate();
      subject = (subjectOverride ?? base.subject).toString();
      htmlBody = (bodyOverride ?? base.body).toString();
    } else {
      // Render from stored template with variables
      const tpl = await this.templateService.getTemplate();
      const rendered = this.templateService.render(tpl, {
        company: company ?? undefined,
        contactName: contactName ?? undefined,
        email: email ?? undefined,
      });
      subject = rendered.subject;
      htmlBody = rendered.body;
    }

    // Always append the non-editable footer before sending
    const finalHtml = await this.templateService.composeWithFooter(htmlBody);

    // Attach default PPT if present
    const attachments = await this.getDefaultAttachments();

    return this.mailClient.send({
      to,
      subject,
      htmlBody: finalHtml,
      attachments,
    });
  }

  private async getDefaultAttachments() {
    try {
      // Allow override via env; else default path in /public/file
      const base = process.env.MAIL_ATTACHMENT_PATH || "public/files/informatie-callingbird";
      const resolved = path.resolve(process.cwd(), base);

      // If a file path with extension, use it. If directory or without extension, try to find a single file.
      let filePath = resolved;
      let stats: any;
      try { stats = await fs.stat(filePath); } catch { stats = null; }

      if (!stats) {
        // Fallback: search in public/files for a PDF
        const altDir = path.resolve(process.cwd(), "public/files");
        try {
          const altStats = await fs.stat(altDir);
          if (altStats.isDirectory()) {
            const files = await fs.readdir(altDir);
            const preferred = files.find(f => /\.pdf$/i.test(f))
              || files.find(f => /\.pptx$/i.test(f));
            if (preferred) {
              const altPath = path.join(altDir, preferred);
              const content = await fs.readFile(altPath);
              const filename = path.basename(altPath);
              const ext = path.extname(filename).toLowerCase();
              const contentType = ext === ".pdf"
                ? "application/pdf"
                : ext === ".pptx"
                  ? "application/vnd.openxmlformats-officedocument.presentationml.presentation"
                  : "application/octet-stream";
              return [{ filename, content, contentType }];
            }
          }
        } catch {}
        return [];
      }

      if (stats.isDirectory()) {
        const files = await fs.readdir(filePath);
        // Prefer .pdf, then .pptx, else first
        const preferred = files.find(f => /\.pdf$/i.test(f))
          || files.find(f => /\.pptx$/i.test(f))
          || files[0];
        if (!preferred) return [];
        filePath = path.join(filePath, preferred);
      } else if (!/\.[^.]+$/.test(filePath)) {
        // No extension: attempt .pdf first, then .pptx
        const tryPdf = `${filePath}.pdf`;
        const tryPptx = `${filePath}.pptx`;
        let picked: string | null = null;
        try { const s = await fs.stat(tryPdf); if (s.isFile()) picked = tryPdf; } catch {}
        if (!picked) { try { const s2 = await fs.stat(tryPptx); if (s2.isFile()) picked = tryPptx; } catch {} }
        if (!picked) return [];
        filePath = picked;
      }

      const content = await fs.readFile(filePath);
      const filename = path.basename(filePath);
      const ext = path.extname(filename).toLowerCase();
      const contentType = ext === ".pdf"
        ? "application/pdf"
        : ext === ".pptx"
          ? "application/vnd.openxmlformats-officedocument.presentationml.presentation"
          : "application/octet-stream";
      return [ { filename, content, contentType } ];
    } catch (e) {
      console.warn("[MailService] No default attachment included:", e);
      return [];
    }
  }
}
