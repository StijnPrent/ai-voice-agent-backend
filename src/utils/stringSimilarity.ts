const bigrams = (value: string): string[] => {
    const normalized = value.toLowerCase().replace(/\s+/g, " ").trim();
    const grams: string[] = [];
    for (let i = 0; i < normalized.length - 1; i++) {
        grams.push(normalized.slice(i, i + 2));
    }
    return grams;
};

/**
 * Returns a Dice coefficient-like similarity score between 0 and 1.
 */
export const normalizeSimilarityScore = (a: string, b: string): number => {
    const aNorm = (a || "").trim();
    const bNorm = (b || "").trim();
    if (!aNorm || !bNorm) return 0;
    if (aNorm.toLowerCase() === bNorm.toLowerCase()) return 1;

    const aBigrams = bigrams(aNorm);
    const bBigrams = bigrams(bNorm);
    if (!aBigrams.length || !bBigrams.length) return 0;

    const counts: Record<string, number> = {};
    for (const gram of aBigrams) counts[gram] = (counts[gram] || 0) + 1;

    let overlap = 0;
    for (const gram of bBigrams) {
        if (counts[gram]) {
            overlap++;
            counts[gram]--;
        }
    }

    return (2 * overlap) / (aBigrams.length + bBigrams.length);
};
