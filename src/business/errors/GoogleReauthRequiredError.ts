export class GoogleReauthRequiredError extends Error {
    public readonly statusCode: number;
    public readonly authUrl: string;
    public readonly companyId: string;

    constructor(companyId: string, authUrl: string, statusCode = 401) {
        super(`Google re-authentication required for company ${companyId}.`);
        this.name = "GoogleReauthRequiredError";
        this.statusCode = statusCode;
        this.authUrl = authUrl;
        this.companyId = companyId;
    }
}

export default GoogleReauthRequiredError;
