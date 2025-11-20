export class EmailNotVerifiedError extends Error {
  public readonly code = "EMAIL_NOT_VERIFIED";

  constructor() {
    super("Je e-mailadres is nog niet bevestigd. Controleer je inbox voor de verificatielink.");
    this.name = "EmailNotVerifiedError";
  }
}
