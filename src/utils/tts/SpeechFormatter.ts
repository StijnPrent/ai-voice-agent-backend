// src/utils/tts/SpeechFormatter.ts
export class SpeechFormatter {
    public static format(text: string): string[] {
        const chunks: string[] = [];
        const pauseRegex = /\[\[pause:(\d+)]]/g;
        let lastIndex = 0;
        let match;

        while ((match = pauseRegex.exec(text)) !== null) {
            // Add the text before the pause
            if (match.index > lastIndex) {
                chunks.push(text.substring(lastIndex, match.index));
            }

            // Add a "silence" chunk
            const pauseDuration = parseInt(match[1], 10);
            chunks.push(`<silence_m_s_${pauseDuration}>`);

            lastIndex = match.index + match[0].length;
        }

        // Add the remaining text after the last pause
        if (lastIndex < text.length) {
            chunks.push(text.substring(lastIndex));
        }

        return chunks.filter(chunk => chunk.trim() !== '');
    }
}
