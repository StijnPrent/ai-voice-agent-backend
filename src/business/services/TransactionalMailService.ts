import { inject, injectable } from "tsyringe";
import { IMailClient } from "../../clients/MailClient";
import { IMailLogRepository } from "../../data/interfaces/IMailLogRepository";
import { promises as fs } from "fs";
import path from "path";
import config from "../../config/config";

type TemplateKey =
  | "email-verification"
  | "password-reset"
  | "early-access"
  | "invoice-issued"
  | "invoice-paid"
  | "trial-started"
  | "caller-note";

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
  private readonly systemFrom: string;

  constructor(
    @inject("IMailClient") private readonly mailClient: IMailClient,
    @inject("IMailLogRepository") private readonly mailLogRepository: IMailLogRepository
  ) {
    this.systemFrom = process.env.NOREPLY_FROM || "noreply@callingbird.nl";
  }

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
      from: this.systemFrom,
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
      from: this.systemFrom,
    });
  }

  public async sendEarlyAccessConfirmation(params: {
    to: string;
    name?: string | null;
    company?: string | null;
  }): Promise<void> {
    const unsubscribeUrl = this.buildUnsubscribeUrl(params.to);
    const rendered = await this.renderTemplate(
      "early-access",
      { ...params, unsubscribeUrl },
      this.defaultEarlyAccessTemplate()
    );
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

  public async sendInvoiceIssued(params: {
    to: string;
    companyName?: string | null;
    invoiceNumber: string;
    amount: number;
    currency?: string;
    usageMinutes?: number;
    pricePerMinute?: number;
    dueDate?: string;
    paymentLink?: string | null;
  }): Promise<void> {
    const rendered = await this.renderTemplate(
      "invoice-issued",
      {
        ...params,
        amount: params.amount.toFixed(2),
        currency: params.currency ?? "EUR",
        usageMinutes:
          typeof params.usageMinutes === "number"
            ? params.usageMinutes.toString()
            : params.usageMinutes,
        pricePerMinute:
          typeof params.pricePerMinute === "number"
            ? params.pricePerMinute.toString()
            : params.pricePerMinute,
      },
      this.defaultInvoiceIssuedTemplate()
    );
    await this.dispatchMail({
      type: "invoice-issued",
      template: "invoice-issued",
      to: params.to,
      subject: rendered.subject,
      htmlBody: rendered.html,
      textBody: rendered.text,
      payload: params,
      from: this.systemFrom,
    });
  }

  public async sendInvoicePaid(params: {
    to?: string;
    companyName?: string | null;
    invoiceNumber: string;
    amount: number;
    currency?: string;
  }): Promise<void> {
    if (!params.to) {
      return;
    }
    const rendered = await this.renderTemplate(
      "invoice-paid",
      {
        ...params,
        amount: params.amount.toFixed(2),
        currency: params.currency ?? "EUR",
      },
      this.defaultInvoicePaidTemplate()
    );
    await this.dispatchMail({
      type: "invoice-paid",
      template: "invoice-paid",
      to: params.to,
      subject: rendered.subject,
      htmlBody: rendered.html,
      textBody: rendered.text,
      payload: params,
      from: this.systemFrom,
    });
  }

  public async sendTrialStarted(params: {
    to: string;
    companyName?: string | null;
    trialEndsAt: string;
  }): Promise<void> {
    const rendered = await this.renderTemplate(
      "trial-started",
      params,
      this.defaultTrialStartedTemplate()
    );
    await this.dispatchMail({
      type: "trial-started",
      template: "trial-started",
      to: params.to,
      subject: rendered.subject,
      htmlBody: rendered.html,
      textBody: rendered.text,
      payload: params,
      from: this.systemFrom,
    });
  }

  public async sendCallerNote(params: {
    to: string;
    companyName?: string | null;
    callerName?: string | null;
    callerNumber?: string | null;
    note: string;
  }): Promise<void> {
    const rendered = await this.renderTemplate(
      "caller-note",
      params,
      this.defaultCallerNoteTemplate()
    );

    await this.dispatchMail({
      type: "caller-note",
      template: "caller-note",
      to: params.to,
      subject: rendered.subject,
      htmlBody: rendered.html,
      textBody: rendered.text,
      payload: params,
      from: this.systemFrom,
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
    from?: string;
  }): Promise<void> {
    try {
      const response = await this.mailClient.send({
        to: input.to,
        subject: input.subject,
        htmlBody: input.htmlBody,
        textBody: input.textBody,
        from: input.from,
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

  private buildUnsubscribeUrl(email: string): string {
    const base = (config.serverUrl || "").replace(/\/+$/, "");
    const encoded = encodeURIComponent(email);
    return `${base}/email/early-access/unsubscribe?email=${encoded}`;
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
            <p style="font-size:12px;color:#475569;">Wil je geen updates meer? <a href="{{unsubscribeUrl}}" style="color:#1d4ed8;text-decoration:underline;">Afmelden</a></p>
            <p>Groeten,<br/>Team CallingBird</p>
          </body>
        </html>
      `,
    };
  }

  private defaultInvoiceIssuedTemplate() {
    return {
      subject: "Je nieuwe CallingBird factuur {{invoiceNumber}}",
      body: `
        <html>
          <body style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;line-height:1.5">
            <h2 style="margin:0 0 12px 0;color:#0f172a;">Factuur {{invoiceNumber}}</h2>
            <p>Hallo {{companyName}},</p>
            <p>Er staat een nieuwe factuur klaar voor je CallingBird-gebruik.</p>
            <ul>
              <li>Bedrag: {{currency}} {{amount}}</li>
              <li>Verbruik: {{usageMinutes}} minuten</li>
              <li>Tarief: {{pricePerMinute}} per minuut</li>
              <li>Vervaldatum: {{dueDate}}</li>
            </ul>
            <p>We incasseren dit bedrag automatisch via SEPA. Als je de status wilt volgen of direct wilt betalen, gebruik dan deze link: <a href="{{paymentLink}}">Bekijk betaling</a>.</p>
            <p>Heb je vragen? Reageer gerust op dit bericht.</p>
          </body>
        </html>
      `,
    };
  }

  private defaultInvoicePaidTemplate() {
    return {
      subject: "Betaling ontvangen voor factuur {{invoiceNumber}}",
      body: `
        <html>
          <body style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;line-height:1.5">
            <h2 style="margin:0 0 12px 0;color:#0f172a;">Bedankt voor je betaling</h2>
            <p>We hebben de betaling voor factuur {{invoiceNumber}} ontvangen.</p>
            <p>Totaal: {{currency}} {{amount}}</p>
            <p>Heb je vragen over deze betaling? Laat het ons weten.</p>
          </body>
        </html>
      `,
    };
  }

  private defaultTrialStartedTemplate() {
    return {
      subject: "Je 14-daagse proef bij CallingBird is gestart",
      body: `
        <html>
          <body style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;line-height:1.5">
            <h2 style="margin:0 0 12px 0;color:#0f172a;">Welkom bij CallingBird</h2>
            <p>We hebben je account aangemaakt en je SEPA-incasso ingesteld. Je proef loopt tot {{trialEndsAt}}.</p>
            <p>Na de proefperiode zetten we je abonnement automatisch om naar betaald en schrijven we het gebruik maandelijks af.</p>
            <p>Stel je account in en start direct via onze app.</p>
          </body>
        </html>
      `,
    };
  }

  private defaultCallerNoteTemplate() {
    return {
      subject: "Nieuwe notitie van een beller voor {{companyName}}",
      body: `
        <html>
          <body style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;line-height:1.5">
            <h2 style="margin:0 0 12px 0;color:#0f172a;">Nieuwe notitie</h2>
            <p>Er is een notitie achtergelaten voor {{companyName}}.</p>
            <ul style="padding-left:18px;">
              <li><strong>Beller:</strong> {{callerName}}</li>
              <li><strong>Telefoon:</strong> {{callerNumber}}</li>
            </ul>
            <p><strong>Notitie:</strong></p>
            <p style="padding:12px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">{{note}}</p>
            <p style="margin-top:16px;font-size:12px;color:#475569;">Deze e-mail is automatisch verstuurd door CallingBird.</p>
          </body>
        </html>
      `,
    };
  }
}
