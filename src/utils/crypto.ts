// src/utils/crypto.ts

import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
// Make sure you set MASTER_KEY in your .env as a 64-hex-char (32-byte) string
const MASTER_KEY = Buffer.from(process.env.MASTER_KEY || "", "hex");
if (MASTER_KEY.length !== 32) {
    throw new Error(
        "MASTER_KEY must be 32 bytes (64 hex characters) in your .env"
    );
}

export interface Encrypted {
    data: string;  // hex ciphertext
    iv: string;    // hex initialization vector
    tag: string;   // hex GCM auth tag
}

/**
 * Encrypts a UTF-8 string with AES-256-GCM.
 */
export function encrypt(text: string): Encrypted {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, MASTER_KEY, iv);
    const ciphertext = Buffer.concat([
        cipher.update(text, "utf8"),
        cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return {
        data: ciphertext.toString("hex"),
        iv: iv.toString("hex"),
        tag: tag.toString("hex"),
    };
}

/**
 * Decrypts a hex-encoded ciphertext produced by `encrypt`.
 */
export function decrypt(
    encryptedHex: string,
    ivHex: string,
    tagHex: string
): string {
    const iv = Buffer.from(ivHex, "hex");
    const tag = Buffer.from(tagHex, "hex");
    const decipher = crypto.createDecipheriv(ALGORITHM, MASTER_KEY, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([
        decipher.update(Buffer.from(encryptedHex, "hex")),
        decipher.final(),
    ]);
    return decrypted.toString("utf8");
}
