import fc, {Arbitrary} from "fast-check";
import {Draft, produce} from "immer";
import {Root} from "mdast";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {apiContentArbitrarySpaceId} from "~/shared/api/markdown/test_helpers/api_content_arbitrary.js";
import {assert} from "~/shared/helpers/control/assert.js";

// This file can only be imported in Jest unit tests.
assert(import.meta.jest);

export function runAgentWebPageGenerativeTests<PageLink, Page>({
    print,
    parse,
    pageLink: pageLinkArbitrary,
    page: pageArbitrary,
    normalize: normalizeDraft,
}: {
    print: (storage: AgentWebSessionStorage, pageLink: PageLink, page: Page) => Promise<Root>;
    parse: (
        storage: AgentWebSessionStorage,
        pageLink: PageLink | null,
        root: Root,
    ) => Promise<Page>;
    pageLink: Arbitrary<PageLink>;
    page: Arbitrary<Page>;
    normalize: (page: Draft<Page>) => void;
}) {
    import.meta.jest.setTimeout(15 * 1000);
    fc.configureGlobal({interruptAfterTimeLimit: 5 * 1000});

    const storage = createAgentWebSessionStorageForTest(apiContentArbitrarySpaceId);

    function normalize(page: Page) {
        return produce(page, normalizeDraft);
    }

    test("can parse exact same content that was printed", async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.record({pageLink: pageLinkArbitrary, page: pageArbitrary}),
                async ({pageLink, page}) => {
                    await storage.deleteAll();

                    const markdown = await print(storage, pageLink, page);

                    expect(normalize(await parse(storage, pageLink, markdown))).toEqual(
                        normalize(page),
                    );
                },
            ),
            {
                // Run until we reach our 10s timeout.
                numRuns: Infinity,
            },
        );
    });
}
