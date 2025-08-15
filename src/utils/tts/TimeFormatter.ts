// helper: maak tijden TTS-vriendelijk
export function toDutchSpeech(slot: string): string {
    const [hStr, mStr] = slot.split(":");
    const h = parseInt(hStr, 10);
    const m = parseInt(mStr, 10);

    if (m === 0) return `${h} uur`;
    if (m === 30) return `half ${((h + 1) % 24)}`; // 10:30 => "half 11"

    // fallback (mocht je ooit 15/45 gaan gebruiken)
    return `${h} uur ${m}`;
}
