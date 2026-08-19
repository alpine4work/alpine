import {normalizeAgentWebPath} from "~/server/agents/web/normalize_agent_web_path.open_source.js";

test("adds a leading slash when one is missing", () => {
    expect(normalizeAgentWebPath("messages/inbox").path).toBe("/messages/inbox");
});

test("strips URL hash fragments", () => {
    expect(normalizeAgentWebPath("/messages/inbox#activity").path).toBe("/messages/inbox");
});

test("preserves search param order in the normalized path", () => {
    expect(normalizeAgentWebPath("/search?zebra=1&apple=2&middle=3").path).toBe(
        "/search?zebra=1&apple=2&middle=3",
    );
});

test("preserves search param order in the returned searchParams object", () => {
    expect(normalizeAgentWebPath("/search?zebra=1&apple=2&middle=3").searchParams.toString()).toBe(
        "zebra=1&apple=2&middle=3",
    );
});

test("preserves interleaved repeated-key search param order", () => {
    expect(normalizeAgentWebPath("/search?b=2&a=1&b=1&a=0").path).toBe("/search?b=2&a=1&b=1&a=0");
});

test("keeps empty values", () => {
    expect(normalizeAgentWebPath("/search?b&c=3&a").path).toBe("/search?b=&c=3&a=");
});

test("drops hash content before parsing query params", () => {
    expect(normalizeAgentWebPath("/search?b=2#a=1&c=3").path).toBe("/search?b=2");
});
