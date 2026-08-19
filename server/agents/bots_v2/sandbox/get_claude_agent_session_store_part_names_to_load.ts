type ClaudeAgentSessionStorePart = {
    readonly name: string;
    readonly time: number;
    readonly type: "Part" | "Snapshot";
};

/** Selects the latest complete snapshot plus any parts appended after it. */
export function getClaudeAgentSessionStorePartNamesToLoad(
    names: ReadonlyArray<string>,
): ReadonlyArray<string> {
    const parts: Array<ClaudeAgentSessionStorePart> = [];

    for (const name of names) {
        const match = /^(part|snapshot)-(\d{16})\.jsonl$/.exec(name);
        if (match === null) continue;

        const [, rawType, rawTime] = match;
        parts.push({
            name,
            time: Number(rawTime),
            type: rawType === "snapshot" ? "Snapshot" : "Part",
        });
    }

    const latestSnapshot = parts
        .filter(part => part.type === "Snapshot")
        .sort((a, b) => b.time - a.time)[0];

    return parts
        .filter(part => {
            if (latestSnapshot === undefined) return part.type === "Part";
            return (
                part === latestSnapshot || (part.type === "Part" && part.time > latestSnapshot.time)
            );
        })
        .sort((a, b) => a.time - b.time)
        .map(part => part.name);
}
