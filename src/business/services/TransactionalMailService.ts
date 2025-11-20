import { inject, injectable } from "tsyringe";
import { IMailClient } from "../../clients/MailClient";
import { IMailLogRepository } from "../../data/interfaces/IMailLogRepository";
import { promises as fs } from "fs";
import path from "path";
import config from "../../config/config";

type TemplateKey = "email-verification" | "password-reset" | "early-access";

interface TemplateVars {
  [key: string]: string | null | undefined;
}

interface RenderedTemplate {
  subject: string;
  html: string;
  text: string;
}

@injectable()
export class TransactionalMailService {
  private readonly templateDir = path.resolve(process.cwd(), "public", "mail-templates");
  private readonly cache = new Map<TemplateKey, { subject: string; body: string }>();

  constructor(
    @inject("IMailClient") private readonly mailClient: IMailClient,
    @inject("IMailLogRepository") private readonly mailLogRepository: IMailLogRepository
  ) {}

  public async sendEmailVerification(params: {
    to: string;
    companyName?: string | null;
    verificationUrl: string;
    contactName?: string | null;
  }): Promise<void> {
    const rendered = await this.renderTemplate("email-verification", params, this.defaultVerificationTemplate());
    await this.dispatchMail({
      type: "email-verification",
      template: "email-verification",
      to: params.to,
      subject: rendered.subject,
      htmlBody: rendered.html,
      textBody: rendered.text,
      payload: params,
    });
  }

  public async sendPasswordReset(params: {
    to: string;
    resetUrl: string;
    companyName?: string | null;
  }): Promise<void> {
    const rendered = await this.renderTemplate("password-reset", params, this.defaultPasswordTemplate());
    await this.dispatchMail({
      type: "password-reset",
      template: "password-reset",
      to: params.to,
      subject: rendered.subject,
      htmlBody: rendered.html,
      textBody: rendered.text,
      payload: params,
    });
  }

  public async sendEarlyAccessConfirmation(params: {
    to: string;
    name?: string | null;
    company?: string | null;
  }): Promise<void> {
    const rendered = await this.renderTemplate("early-access", params, this.defaultEarlyAccessTemplate());
    await this.dispatchMail({
      type: "early-access",
      template: "early-access",
      to: params.to,
      subject: rendered.subject,
      htmlBody: rendered.html,
      textBody: rendered.text,
      payload: params,
    });
  }

  private async dispatchMail(input: {
    to: string;
    subject: string;
    htmlBody: string;
    textBody: string;
    type: string;
    template: TemplateKey;
    payload?: Record<string, any>;
  }): Promise<void> {
    try {
      const response = await this.mailClient.send({
        to: input.to,
        subject: input.subject,
        htmlBody: input.htmlBody,
        textBody: input.textBody,
      });

      await this.mailLogRepository.createLog({
        type: input.type,
        template: input.template,
        to: input.to,
        subject: input.subject,
        payload: input.payload ?? null,
        providerMessageId: response.id ?? null,
        status: "sent",
      });
    } catch (error) {
      await this.mailLogRepository.createLog({
        type: input.type,
        template: input.template,
        to: input.to,
        subject: input.subject,
        payload: input.payload ?? null,
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown mail error",
      });
      throw error;
    }
  }

  private async renderTemplate(
    key: TemplateKey,
    vars: TemplateVars,
    fallback: { subject: string; body: string }
  ): Promise<RenderedTemplate> {
    const template = await this.loadTemplate(key, fallback);
    const renderedSubject = this.interpolate(template.subject, vars);
    const renderedBody = this.interpolate(template.body, {
      ...vars,
      frontendUrl: config.frontendUrl,
    });
    const text = this.stripHtml(renderedBody);
    return { subject: renderedSubject, html: renderedBody, text };
  }

  private async loadTemplate(
    key: TemplateKey,
    fallback: { subject: string; body: string }
  ): Promise<{ subject: string; body: string }> {
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }

    const subjectFile = path.join(this.templateDir, `${key}.subject.txt`);
    const bodyFile = path.join(this.templateDir, `${key}.html`);

    try {
      const [subject, body] = await Promise.all([
        fs.readFile(subjectFile, "utf8"),
        fs.readFile(bodyFile, "utf8"),
      ]);
      const compiled = { subject: subject.trim(), body };
      this.cache.set(key, compiled);
      return compiled;
    } catch {
      this.cache.set(key, fallback);
      return fallback;
    }
  }

  private interpolate(template: string, vars: TemplateVars): string {
    return (template || "").replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key) => {
      const value = vars[key];
      return typeof value === "undefined" || value === null ? "" : String(value);
    });
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private defaultVerificationTemplate() {
    return {
      subject: "Bevestig je CallingBird-account",
      body: `
        <html>
          <body style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;line-height:1.5">
            <h2>Welkom bij CallingBird</h2>
            <p>Hi {{contactName}},</p>
            <p>Bedankt voor je aanmelding bij CallingBird. Klik op de knop hieronder om je e-mailadres te bevestigen.</p>
            <p>
              <a href="{{verificationUrl}}" style="display:inline-block;padding:12px 20px;background:#1d4ed8;color:#fff;text-decoration:none;border-radius:6px">
                Bevestig mijn e-mailadres
              </a>
            </p>
            <p>Werkt de knop niet? Kopieer deze link naar je browser:<br/><a href="{{verificationUrl}}">{{verificationUrl}}</a></p>
            <p>Groeten,<br/>Team CallingBird</p>
          </body>
        </html>
      `,
    };
  }

  private defaultPasswordTemplate() {
    return {
      subject: "Reset je wachtwoord voor CallingBird",
      body: `
        <html>
          <body style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;line-height:1.5">
            <h2>Wachtwoord resetten</h2>
            <p>We ontvingen een verzoek om het wachtwoord voor jouw CallingBird-account te resetten.</p>
            <p>Gebruik onderstaande knop om een nieuw wachtwoord in te stellen. Deze link verloopt automatisch.</p>
            <p>
              <a href="{{resetUrl}}" style="display:inline-block;padding:12px 20px;background:#0f766e;color:#fff;text-decoration:none;border-radius:6px">
                Stel nieuw wachtwoord in
              </a>
            </p>
            <p>Werkt de knop niet? Kopieer deze link naar je browser:<br/><a href="{{resetUrl}}">{{resetUrl}}</a></p>
            <p>Heb jij dit verzoek niet ingediend? Negeer deze e-mail dan.</p>
            <p>Groeten,<br/>Team CallingBird</p>
          </body>
        </html>
      `,
    };
  }

  private defaultEarlyAccessTemplate() {
    return {
      subject: "Bedankt voor je early-access aanvraag",
      body: `
        <html>
          <body style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;line-height:1.5">
            <h2>Hey {{name}}, bedankt voor je interesse!</h2>
            <p>We hebben je early-access aanvraag ontvangen voor {{company}}.</p>
            <p>Een van onze teamleden neemt binnen 1 werkdag contact met je op om de volgende stappen te bespreken.</p>
            <p>Kun je niet wachten? Reageer gerust op deze e-mail.</p>
            <p>Groeten,<br/>Team CallingBird</p>
          </body>
        </html>
      `,
    };
  }
}
