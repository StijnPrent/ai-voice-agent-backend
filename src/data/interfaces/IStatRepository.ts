export interface IStatRepository {
    /**
     * Fetch the total number of companies.
     */
    getTotalCompanies(): Promise<number>;

    /**
     * Fetch the total number of users.
     */
    getTotalUsers(): Promise<number>;

    /**
     * Fetch the total number of integrations.
     */
    getTotalIntegrations(): Promise<number>;

    /**
     * Fetch the total number of conversations.
     */
    getTotalConversations(): Promise<number>;
}