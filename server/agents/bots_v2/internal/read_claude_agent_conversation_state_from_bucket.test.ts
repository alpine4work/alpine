import {readClaudeAgentConversationStateFromBucket} from "~/server/agents/bots_v2/internal/read_claude_agent_conversation_state_from_bucket.js";

/**
 * The bucket the reader takes, borrowed from its own signature. The Workers
 * `R2Bucket` global isn't in scope when tests are type checked.
 */
type TestClaudeAgentBucket = Parameters<typeof readClaudeAgentConversationStateFromBucket>[0];

const sandboxId = "sandbox-1";
const sessionId = "session-1";
const stateKey = `sandbox/${sandboxId}/state.json`;
const transcriptPrefix = `sandbox/${sandboxId}/sessions/-workspace-agent/${sessionId}`;

test("will read a snapshot before the parts appended after it", async () => {
    // The shape an approval resume leaves behind: one snapshot holding the
    // conversation so far, then the appends the SDK made once it resumed.
    const bucket = createTestBucket(
        new Map([
            [stateKey, JSON.stringify({sessionId})],
            [`${transcriptPrefix}/snapshot-0001786000000000.jsonl`, toJsonLines("first", "second")],
            [`${transcriptPrefix}/part-0001786000000001.jsonl`, toJsonLines("third")],
        ]),
    );

    const state = await readClaudeAgentConversationStateFromBucket(bucket, sandboxId);

    // Chronological. Sorting the keys instead would put `part-` ahead of `snapshot-`
    // however new the snapshot is, opening the transcript on its own tail.
    expect(state.items).toEqual([{uuid: "first"}, {uuid: "second"}, {uuid: "third"}]);
});

test("will ignore a part the snapshot superseded", async () => {
    // `replaceWithSnapshot()` records a failed delete rather than throwing, so a part
    // older than the snapshot can outlive the snapshot that replaced it.
    const bucket = createTestBucket(
        new Map([
            [stateKey, JSON.stringify({sessionId})],
            [`${transcriptPrefix}/part-0001785000000000.jsonl`, toJsonLines("pre-surgery")],
            [`${transcriptPrefix}/snapshot-0001786000000000.jsonl`, toJsonLines("resolved")],
        ]),
    );

    const state = await readClaudeAgentConversationStateFromBucket(bucket, sandboxId);

    expect(state.items).toEqual([{uuid: "resolved"}]);
});

/**
 * One transcript entry per line, carrying only a `uuid` so assertions stay short.
 */
function toJsonLines(...uuids: Array<string>): string {
    return uuids.map(uuid => JSON.stringify({uuid})).join("\n") + "\n";
}

/**
 * A stand-in for the sandbox's R2 bucket. The reader only ever calls `get()` and
 * `list()`, and listing sorts by key the way R2 itself does — so the reader gets
 * the same ordering here that production hands it.
 */
function createTestBucket(bodyByKey: ReadonlyMap<string, string>): TestClaudeAgentBucket {
    return {
        get: async (key: string) => {
            const body = bodyByKey.get(key);
            return body === undefined ? null : {text: async () => body};
        },
        list: async ({prefix}: {prefix?: string}) => ({
            objects: [...bodyByKey.keys()]
                .filter(key => prefix === undefined || key.startsWith(prefix))
                .sort()
                .map(key => ({key})),
            truncated: false,
        }),
    } as unknown as TestClaudeAgentBucket;
}
