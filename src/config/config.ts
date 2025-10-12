// src/config/config.ts

import dotenv from "dotenv";
dotenv.config();

interface Config {
    port: number;
    nodeEnv: string;

    // Twilio
    twilioSid: string;
    twilioAuth: string;
    twilioFrom: string;
    twilioTo: string;

    // Google OAuth callback URI (shared)
    googleRedirectUri: string;
    googleClientId?: string;
    googleClientSecret?: string;

    // Outlook OAuth
    outlookRedirectUri: string;
    outlookClientId?: string;
    outlookClientSecret?: string;
    outlookTenantId?: string;

    // Database
    dbHost: string;
    dbUser: string;
    dbPassword: string;
    dbName: string;
    dbPort: number;

    // Frontend
    frontendUrl: string;

    // JWT
    jwtSecret: string;
    jwtExpiration: string;

    // Encryption
    masterKey: string;

    // Server
    serverUrl: string;
}

const config: Config = {
    port: Number(process.env.PORT) || 3002,
    nodeEnv: process.env.NODE_ENV || "development",

    twilioSid: process.env.TWILIO_SID || "",
    twilioAuth: process.env.TWILIO_AUTH || "",
    twilioFrom: process.env.TWILIO_FROM || "",
    twilioTo: process.env.TWILIO_TO || "",

    //redirect URI for Google OAuth
    googleRedirectUri: process.env.GOOGLE_REDIRECT_URI || "http://localhost:3000",
    googleClientId: process.env.GOOGLE_CLIENT_ID,
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,

    //redirect URI for Outlook OAuth
    outlookRedirectUri: process.env.OUTLOOK_REDIRECT_URI || "http://localhost:3000",
    outlookClientId: process.env.OUTLOOK_CLIENT_ID,
    outlookClientSecret: process.env.OUTLOOK_CLIENT_SECRET,
    outlookTenantId: process.env.OUTLOOK_TENANT_ID,

    dbHost: process.env.DB_HOST || "localhost",
    dbUser: process.env.DB_USER || "root",
    dbPassword: process.env.DB_PASSWORD || "",
    dbName: process.env.DB_NAME || "",
    dbPort: Number(process.env.DB_PORT) || 3306,

    frontendUrl: process.env.FRONTEND_URL || "http://localhost:3000",

    jwtSecret: process.env.JWT_SECRET || "",
    jwtExpiration: process.env.JWT_EXPIRATION || "8h",

    masterKey: process.env.MASTER_KEY || "",

    serverUrl: process.env.SERVER_URL || "http://localhost:3002",
};

// Validate critical values
if (!config.twilioSid || !config.twilioAuth) throw new Error("❌ Missing Twilio credentials in .env");
if (!config.googleRedirectUri) throw new Error("❌ Missing GOOGLE_REDIRECT_URI in .env");
if (!config.outlookRedirectUri) throw new Error("❌ Missing OUTLOOK_REDIRECT_URI in .env");
if (!config.jwtSecret) throw new Error("❌ Missing JWT_SECRET in .env");
if (!config.masterKey) throw new Error("❌ Missing MASTER_KEY in .env");

export default config;
