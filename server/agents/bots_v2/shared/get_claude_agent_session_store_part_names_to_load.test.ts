import {getClaudeAgentSessionStorePartNamesToLoad} from "~/server/agents/bots_v2/shared/get_claude_agent_session_store_part_names_to_load.js";

test("will load every append-only part before the first rewrite", () => {
    expect(
        getClaudeAgentSessionStorePartNamesToLoad([
            "part-0000000000000002.jsonl",
            "ignored.txt",
            "part-0000000000000001.jsonl",
        ]),
    ).toEqual(["part-0000000000000001.jsonl", "part-0000000000000002.jsonl"]);
});

test("will load only the latest snapshot and parts appended after it", () => {
    expect(
        getClaudeAgentSessionStorePartNamesToLoad([
            "part-0000000000000001.jsonl",
            "snapshot-0000000000000002.jsonl",
            "part-0000000000000003.jsonl",
            "snapshot-0000000000000004.jsonl",
            "part-0000000000000005.jsonl",
        ]),
    ).toEqual(["snapshot-0000000000000004.jsonl", "part-0000000000000005.jsonl"]);
});

test("will ignore an old append left behind after a completed snapshot write", () => {
    expect(
        getClaudeAgentSessionStorePartNamesToLoad([
            "part-0000000000000001.jsonl",
            "snapshot-0000000000000002.jsonl",
        ]),
    ).toEqual(["snapshot-0000000000000002.jsonl"]);
});
