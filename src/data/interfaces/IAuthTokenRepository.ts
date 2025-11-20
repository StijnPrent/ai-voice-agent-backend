export type AuthTokenType = "email-verification" | "password-reset";

export interface AuthTokenRecord {
  id: number;
  companyId: bigint;
  tokenHash: string;
  type: AuthTokenType;
  expiresAt: Date;
  consumedAt: Date | null;
  metadata: Record<string, any> | null;
}

export interface CreateAuthTokenParams {
  companyId: bigint;
  tokenHash: string;
  type: AuthTokenType;
  expiresAt: Date;
  metadata?: Record<string, any> | null;
}

export interface IAuthTokenRepository {
  createToken(params: CreateAuthTokenParams): Promise<number>;
  findValidToken(type: AuthTokenType, tokenHash: string): Promise<AuthTokenRecord | null>;
  markConsumed(tokenId: number): Promise<void>;
  invalidateTokens(companyId: bigint, type: AuthTokenType): Promise<void>;
}
