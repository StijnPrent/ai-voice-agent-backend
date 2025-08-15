import {toDutchSpeech} from "./TimeFormatter";

export function summarizeSlots(slots: string[], openHour: number, closeHour: number): string {
    const totalSlots = ((closeHour - openHour) * 60) / 30; // totaal aantal 30-min slots
    const openSlots = slots.length;
    console.log(openSlots, totalSlots);

    // Als bijna alles vrij is
    if (openSlots >= totalSlots - 2) { // bv. max 1 uur bezet
        // Vind bezette tijden
        const allTimes = [];
        for (let h = openHour; h < closeHour; h++) {
            allTimes.push(`${String(h).padStart(2, '0')}:00`);
            allTimes.push(`${String(h).padStart(2, '0')}:30`);
        }
        const busy = allTimes.filter(t => !slots.includes(t));
        console.log(busy);

        // Zet bezette tijden om naar spreektaal
        const busySpoken = busy.map(toDutchSpeech).join(' en ');
        return `Ik ben de hele dag beschikbaar tussen ${openHour} en ${closeHour} uur, behalve om ${busySpoken}.`;
    }

    // Normale opsomming
    return `Ik heb de volgende tijden beschikbaar: ${slots.map(toDutchSpeech).join(', ')}.`;
}
