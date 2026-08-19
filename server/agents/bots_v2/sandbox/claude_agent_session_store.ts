import {SessionKey, SessionStore, SessionStoreEntry} from "@anthropic-ai/claude-agent-sdk";
import fs from "fs/promises";
import {dirname} from "path";
import {getClaudeAgentSessionStorePartNamesToLoad} from "~/server/agents/bots_v2/sandbox/get_claude_agent_session_store_part_names_to_load.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {isObject} from "~/shared/helpers/object/is_object.open_source.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.open_source.js";

const sessionsDirectory = "/workspace/bucket/sessions";

const sessionStoreFileConcurrency = 16;

/**
 * Where the Claude Agent SDK keeps a conversation's transcript.
 *
 * ## What the SDK wants from us
 *
 * The SDK owns the transcript — the full history of user turns, assistant turns,
 * tool calls and tool results that it replays to the model. It doesn't care where
 * that lives, so it takes a `SessionStore` with three operations: `append()` new
 * entries as a turn runs, `load()` everything back when a session is resumed
 * (`resume: sessionId` in `run_claude_agent.ts`), and delete. By default it writes
 * to the local filesystem, which is useless to us: the container is disposable, so
 * anything not in `/workspace/bucket` is gone the moment the process exits and the
 * next message would start a brand-new conversation.
 *
 * So this is forked from the SDK's own `S3SessionStore` example and pointed at the
 * bucket mount instead:
 * https://github.com/anthropics/claude-agent-sdk-typescript/blob/064793e6da11fbaf00509ef1ab66f374fb379cbc/examples/session-stores/s3/src/S3SessionStore.ts#L33
 *
 * ## Why it's append-only parts instead of one file
 *
 * `/workspace/bucket` is an s3fs-style mount over R2, where a "file" is an object:
 * there's no cheap append, so growing one transcript file would mean rewriting the
 * whole object on every turn. Instead each `append()` drops a new immutable
 * `part-*.jsonl`, and `load()` concatenates them. A transcript rewrite writes a
 * `snapshot-*.jsonl` checkpoint; readers ignore older parts as soon as that object
 * exists, so interrupted cleanup cannot duplicate the transcript. Names carry a
 * fixed-width epoch-ms suffix, and reads are batched because each one is a network
 * round trip.
 *
 * Everything is addressed by `SessionKey` — see `findMainSessionKey()` for what
 * `projectKey` is and why we have to go looking for it.
 */

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
        return sessionsDirectory + "/" + parts.join("/") + "/";
    }

    /**
     * Fixed-width epoch ms → lexical sort = chronological. lastMs+1 makes
     * same-instance same-ms appends deterministic
     *
     * We keep two kinds of parts: "part" and "snapshot". "part" is a regular part of
     * the transcript, and "snapshot" is a durable checkpoint. As soon as a snapshot
     * exists, `load()` ignores every older part. Cleanup can therefore be interrupted
     * without exposing both generations or losing the replacement.
     */
    #nextPartName(type: "part" | "snapshot"): string {
        const now = Date.now();
        const ms = Math.max(now, this.#lastMs + 1);
        this.#lastMs = ms;
        return `${type}-${ms.toString().padStart(16, "0")}.jsonl`;
    }

    async append(key: SessionKey, entries: Array<SessionStoreEntry>): Promise<void> {
        if (entries.length === 0) {
            return;
        }

        await this.#parentSpan.withSpan("Append Claude agent session store", async () => {
            await this.#writePart(key, entries);
        });
    }

    /**
     * Writes `entries` as a new part under the key. Part names are monotonic, so a new
     * part always sorts after the existing ones and `load()` reads it last.
     */
    async #writePart(
        key: SessionKey,
        entries: ReadonlyArray<SessionStoreEntry>,
        type: "part" | "snapshot" = "part",
    ): Promise<string> {
        const objectKey = this.#keyPrefix(key) + this.#nextPartName(type);
        const body = entries.map(e => JSON.stringify(e)).join("\n") + "\n";

        await fs.mkdir(dirname(objectKey), {recursive: true});
        await fs.writeFile(objectKey, body);

        return objectKey;
    }

    async load(key: SessionKey): Promise<Array<SessionStoreEntry> | null> {
        return await this.#parentSpan.withSpan("Load Claude agent session store", async span => {
            const prefix = this.#keyPrefix(key);

            const keys = getClaudeAgentSessionStorePartNamesToLoad(await fs.readdir(prefix)).map(
                name => prefix + name,
            );

            span.addData({common: {count: keys.length}});

            if (keys.length === 0) {
                return null;
            }

            // Bounded-parallel read file (serial is N×RTT); preserves sorted-key order.
            const allEntries: Array<SessionStoreEntry> = [];
            for (let i = 0; i < keys.length; i += sessionStoreFileConcurrency) {
                const batch = keys.slice(i, i + sessionStoreFileConcurrency);
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

    /**
     * Finds the `SessionKey` for a session's **main** transcript by its session ID.
     *
     * A `SessionKey` has two parts. `sessionId` identifies one conversation — that's
     * the value we persist in `state.json` and hand back as `resume`. `projectKey`
     * identifies the _workspace_ the conversation belongs to, and the SDK derives it
     * itself by sanitizing the cwd (the same convention as Claude Code's
     * `~/.claude/projects/-Users-you-some-repo/`). Ours is always `/workspace/agent`,
     * so in practice there's one project key, but it's the SDK's format to define and
     * re-deriving it here would mean copying a sanitization rule that could change
     * under us.
     *
     * So instead of computing it we look for it: the main transcript is the directory
     * at `sessions/{projectKey}/{sessionId}/`, so probe each project key for one that
     * has this session under it.
     *
     * Returns `null` if no such session directory exists.
     */
    async findMainSessionKey(sessionId: string): Promise<SessionKey | null> {
        return await this.#parentSpan.withSpan("Find Claude agent main session key", async span => {
            const projectKeys = await fs.readdir(sessionsDirectory).catch(error => {
                if (isObject(error) && error.code === "ENOENT") return [];
                throw error;
            });

            // Probe the candidates together rather than one at a time: this runs on the
            // interactive approval resume, over an R2-backed mount where each `stat` is a
            // round trip.
            const found = await runAllPromises(
                projectKeys.map(async projectKey => {
                    const exists = await fs
                        .stat(`${sessionsDirectory}/${projectKey}/${sessionId}`)
                        .then(stat => stat.isDirectory())
                        .catch(error => {
                            if (isObject(error) && error.code === "ENOENT") return false;
                            throw error;
                        });

                    return exists ? projectKey : null;
                }),
            );

            const projectKey = found.find(candidate => candidate !== null) ?? null;

            span.addData({common: {didNothing: projectKey === null}});

            return projectKey === null ? null : {projectKey, sessionId};
        });
    }

    /**
     * Replaces a transcript's contents with `entries`, written as a snapshot that
     * makes every older part obsolete. Used by approvals surgery to resolve pending
     * tool calls before resuming.
     *
     * Only touches the `.jsonl` files sitting _directly_ in the key's directory.
     * `SessionKey` has an optional third component, `subpath`, which `#keyPrefix()`
     * appends as a nested directory — that's where the SDK keeps a subagent's own
     * transcript, so a session's tree looks like:
     *
     * ```
     * sessions/{projectKey}/{sessionId}/part-0000000001700000000000.jsonl   ← main
     * sessions/{projectKey}/{sessionId}/part-0000000001700000000001.jsonl   ← main
     * sessions/{projectKey}/{sessionId}/{subpath}/part-….jsonl              ← a subagent
     * ```
     *
     * `readdir` returns the subagent directory alongside the parts, and the `.jsonl`
     * filter is what skips it. That matters because approvals only ever replace the
     * main transcript — the parked tool calls belong to the top-level turn — and
     * deleting a subagent's transcript along the way would silently drop history the
     * main transcript still refers to.
     */
    async replaceWithSnapshot(key: SessionKey, entries: Array<SessionStoreEntry>): Promise<void> {
        await this.#parentSpan.withSpan(
            "Replace Claude agent session with snapshot",
            async span => {
                const prefix = this.#keyPrefix(key);

                const existingNames = (await fs.readdir(prefix)).filter(name =>
                    name.endsWith(".jsonl"),
                );

                // A snapshot is a durable checkpoint: as soon as it exists, `load()` ignores every
                // older part. Cleanup can therefore be interrupted without exposing both
                // generations or losing the replacement.
                const objectKey = await this.#writePart(key, entries, "snapshot");

                const obsoleteNames = existingNames.filter(name => prefix + name !== objectKey);

                await runAllPromises(
                    obsoleteNames.map(async name => {
                        await fs.rm(prefix + name).catch(error => span.addException(error));
                    }),
                );

                span.addData({common: {count: existingNames.length}});
            },
        );
    }

    /** Keeps only the transcript referenced by the archived failure state. */
    async deleteSessionsExcept(sessionId: string | null): Promise<void> {
        await this.#parentSpan.withSpan("Delete abandoned Claude agent sessions", async span => {
            const projectKeys = await fs.readdir(sessionsDirectory).catch(error => {
                if (isObject(error) && error.code === "ENOENT") return [];
                throw error;
            });

            for (const projectKey of projectKeys) {
                const projectDirectory = `${sessionsDirectory}/${projectKey}`;
                const storedSessionIds = await fs.readdir(projectDirectory);
                const abandonedSessionIds = storedSessionIds.filter(
                    storedSessionId => storedSessionId !== sessionId,
                );

                for (let i = 0; i < abandonedSessionIds.length; i += sessionStoreFileConcurrency) {
                    const batch = abandonedSessionIds.slice(i, i + sessionStoreFileConcurrency);
                    await runAllPromises(
                        batch.map(async abandonedSessionId => {
                            await fs.rm(`${projectDirectory}/${abandonedSessionId}`, {
                                recursive: true,
                            });
                        }),
                    );
                }

                span.addData({common: {count: abandonedSessionIds.length}});
            }
        });
    }
}
