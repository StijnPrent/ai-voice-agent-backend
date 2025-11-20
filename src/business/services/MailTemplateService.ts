import { promises as fs } from "fs";
import path from "path";
import config from "../../config/config";

export interface MailTemplate {
  subject: string;
  body: string; // HTML preferred
}

export class MailTemplateService {
  private baseDir: string;
  private subjectFile: string;
  private bodyFile: string;
  private footerFile: string;

  constructor() {
    // Store under public so it’s easy to inspect; can move to DB later
    this.baseDir = path.resolve(process.cwd(), "public", "mail-templates");
    this.subjectFile = path.join(this.baseDir, "default.subject.txt");
    this.bodyFile = path.join(this.baseDir, "default.html");
    this.footerFile = path.join(this.baseDir, "footer.html");
  }

  public async getTemplate(): Promise<MailTemplate> {
    await this.ensureDefaults();
    const [subject, body] = await Promise.all([
      fs.readFile(this.subjectFile, "utf8"),
      fs.readFile(this.bodyFile, "utf8"),
    ]);
    return { subject: subject.trim(), body };
  }

  public async updateTemplate(template: MailTemplate): Promise<MailTemplate> {
    await fs.mkdir(this.baseDir, { recursive: true });
    await Promise.all([
      fs.writeFile(this.subjectFile, (template.subject ?? "").toString(), "utf8"),
      fs.writeFile(this.bodyFile, (template.body ?? "").toString(), "utf8"),
    ]);
    return this.getTemplate();
  }

  public render(template: MailTemplate, vars: Record<string, string | null | undefined>): MailTemplate {
    const replacer = (s: string) => s.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key) => {
      const v = vars?.[key];
      return (v ?? "").toString();
    });
    return {
      subject: replacer(template.subject),
      body: replacer(template.body),
    };
  }

  /** Returns the footer HTML that is always appended when sending. */
  public async getFooterHtml(): Promise<string> {
    try {
      const html = await fs.readFile(this.footerFile, "utf8");
      // Allow a minimal placeholder for base URL used by images/links
      const replaced = html.replace(/\{\{\s*publicBaseUrl\s*\}\}/g, config.serverUrl);
      return replaced;
    } catch {
      // Fallback rendered default if the file is missing
      return this.defaultFooterTemplate().replace(/\{\{\s*publicBaseUrl\s*\}\}/g, config.serverUrl);
    }
  }

  /** Insert footer HTML before </body> if present, else append. */
  public async composeWithFooter(html: string): Promise<string> {
    const footer = await this.getFooterHtml();
    if (!html) return footer;
    const lower = html.toLowerCase();
    const bodyCloseIdx = lower.lastIndexOf("</body>");
    if (bodyCloseIdx !== -1) {
      return html.slice(0, bodyCloseIdx) + "\n" + footer + "\n" + html.slice(bodyCloseIdx);
    }
    const htmlCloseIdx = lower.lastIndexOf("</html>");
    if (htmlCloseIdx !== -1) {
      return html.slice(0, htmlCloseIdx) + "\n" + footer + "\n" + html.slice(htmlCloseIdx);
    }
    return html + "\n" + footer;
  }

  private defaultFooterTemplate(): string {
    return [
      '<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111">',
      '  <div style="margin-bottom:8px">',
      '    <img src="{{publicBaseUrl}}/img/footer.png" alt="CallingBird" style="max-width:180px;height:auto;display:block" />',
      '  </div>',
      '  <div>Mobiel: <a href="tel:+31637477011" style="color:#1d4ed8;text-decoration:none">+31 6 37 47 70 11</a></div>',
      '  <div>Kantoor: <a href="https://maps.google.com/?q=Neuhuyskade+32,+2596+XL+Den+Haag" style="color:#1d4ed8;text-decoration:none">Neuhuyskade 32, 2596 XL Den Haag</a></div>',
      '  <div>KVK-nummer: 93370792</div>',
      '  <div>Website: <a href="https://callingbird.nl" style="color:#1d4ed8;text-decoration:none">https://callingbird.nl</a></div>',
      '  <!-- Add social icons/images below if desired -->',
      '</div>'
    ].join("\n");
  }

  private async ensureDefaults(): Promise<void> {
    try {
      await fs.access(this.subjectFile);
      await fs.access(this.bodyFile);
    } catch {
      await fs.mkdir(this.baseDir, { recursive: true });
      const defaultSubject = "Hello {{contactName}} from {{company}}";
      const defaultBody = [
        "<html>",
        "  <body>",
        "    <p>Hi {{contactName}},</p>",
        "    <p>We’d love to connect with {{company}}. You can reply to this email or reach us at {{email}}.</p>",
        "    <p>Cheers,<br/>Callingbird</p>",
        "  </body>",
        "</html>",
      ].join("\n");
      await Promise.all([
        fs.writeFile(this.subjectFile, defaultSubject, "utf8"),
        fs.writeFile(this.bodyFile, defaultBody, "utf8"),
      ]);
    }
    // Ensure footer file exists with default content if missing
    try {
      await fs.access(this.footerFile);
    } catch {
      // Write the template form with placeholder so it stays environment-agnostic
      const template = this.defaultFooterTemplate();
      await fs.writeFile(this.footerFile, template, "utf8");
    }
  }
}
