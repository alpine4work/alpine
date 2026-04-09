import {normalizeAgentWebPath} from "~/server/agents/web/internal/normalize_agent_web_path.js";

test("adds a leading slash when one is missing", () => {
    expect(normalizeAgentWebPath("messages/inbox").path).toBe("/messages/inbox");
});

test("strips URL hash fragments", () => {
    expect(normalizeAgentWebPath("/messages/inbox#activity").path).toBe("/messages/inbox");
});

test("alphabetizes search params in the normalized path", () => {
    expect(normalizeAgentWebPath("/search?zebra=1&apple=2&middle=3").path).toBe(
        "/search?apple=2&middle=3&zebra=1",
    );
});

test("alphabetizes search params in the returned searchParams object", () => {
    expect(normalizeAgentWebPath("/search?zebra=1&apple=2&middle=3").searchParams.toString()).toBe(
        "apple=2&middle=3&zebra=1",
    );
});

test("preserves repeated-key value order while alphabetizing keys", () => {
    expect(normalizeAgentWebPath("/search?b=2&a=1&b=1&a=0").path).toBe("/search?a=1&a=0&b=2&b=1");
});

test("uses JavaScript default string ordering for key alphabetization", () => {
    expect(normalizeAgentWebPath("/search?a=1&A=2&aa=3&aA=4").path).toBe(
        "/search?A=2&a=1&aA=4&aa=3",
    );
});

test("keeps empty values while sorting keys", () => {
    expect(normalizeAgentWebPath("/search?b&c=3&a").path).toBe("/search?a=&b=&c=3");
});

test("drops hash content before parsing query params", () => {
    expect(normalizeAgentWebPath("/search?b=2#a=1&c=3").path).toBe("/search?b=2");
});
