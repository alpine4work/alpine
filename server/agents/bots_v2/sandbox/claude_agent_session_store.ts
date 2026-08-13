import {SessionKey, SessionStore, SessionStoreEntry} from "@anthropic-ai/claude-agent-sdk";
import fs from "fs/promises";
import {dirname} from "path";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.open_source.js";

const readFileConcurrency = 16;

// Forked from `S3SessionStore` and adapted to fit our file system storage
// requirements:
// https://github.com/anthropics/claude-agent-sdk-typescript/blob/064793e6da11fbaf00509ef1ab66f374fb379cbc/examples/session-stores/s3/src/S3SessionStore.ts#L33
export class ClaudeAgentSessionStore implements SessionStore {
    #parentSpan: TracerSpan;
    #lastMs = 0;

    constructor(parentSpan: TracerSpan) {
        this.#parentSpan = parentSpan;
    }

    /** Directory prefix for a session (or subpath). Always ends in '/'. */
    #keyPrefix(key: SessionKey): string {
        const parts = [key.projectKey, key.sessionId];
        if (key.subpath) {
            parts.push(key.subpath);
        }
        return "/workspace/bucket/sessions/" + parts.join("/") + "/";
    }

    /**
     * Fixed-width epoch ms → lexical sort = chronological. lastMs+1 makes
     * same-instance same-ms appends deterministic
     */
    #nextPartName(): string {
        const now = Date.now();
        const ms = Math.max(now, this.#lastMs + 1);
        this.#lastMs = ms;
        return `part-${ms.toString().padStart(16, "0")}.jsonl`;
    }

    async append(key: SessionKey, entries: Array<SessionStoreEntry>): Promise<void> {
        if (entries.length === 0) {
            return;
        }

        await this.#parentSpan.withSpan("Append Claude agent session store", async () => {
            const objectKey = this.#keyPrefix(key) + this.#nextPartName();
            const body = entries.map(e => JSON.stringify(e)).join("\n") + "\n";

            await fs.mkdir(dirname(objectKey), {recursive: true});
            await fs.writeFile(objectKey, body);
        });
    }

    async load(key: SessionKey): Promise<Array<SessionStoreEntry> | null> {
        return await this.#parentSpan.withSpan("Load Claude agent session store", async span => {
            const prefix = this.#keyPrefix(key);

            const keys: Array<string> = filterMapArray(await fs.readdir(prefix), key => {
                // Ignore directories. Only include files. We know every file ends with a `.jsonl`
                // since that's what we write in `append()`.
                if (!key.endsWith(".jsonl")) return;

                return prefix + key;
            });

            span.addData({common: {count: keys.length}});

            if (keys.length === 0) {
                return null;
            }

            // Sort by key (lexicographic -- 16-digit epochMs prefix is fixed-width, so lexical
            // order == chronological order)
            keys.sort();

            // Bounded-parallel read file (serial is N×RTT); preserves sorted-key order.
            const allEntries: Array<SessionStoreEntry> = [];
            for (let i = 0; i < keys.length; i += readFileConcurrency) {
                const batch = keys.slice(i, i + readFileConcurrency);
                const bodies = await runAllPromises(
                    batch.map(async objectKey => {
                        return await fs.readFile(objectKey, "utf8");
                    }),
                );
                for (const body of bodies) {
                    if (!body) {
                        continue;
                    }
                    for (const line of body.split("\n")) {
                        const trimmed = line.trim();
                        if (!trimmed) {
                            continue;
                        }
                        try {
                            allEntries.push(JSON.parse(trimmed));
                        } catch {
                            // Skip malformed lines
                        }
                    }
                }
            }

            return allEntries.length > 0 ? allEntries : null;
        });
    }
}
