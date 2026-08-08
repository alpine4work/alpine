import fc, {Arbitrary} from "fast-check";
import {Root} from "mdast";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.open_source.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {apiContentArbitrarySpaceId} from "~/shared/api/content/test_helpers/api_content_arbitrary.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";

// This file can only be imported in Jest unit tests.
assert(import.meta.jest);

export function runAgentWebPageGenerativeTests<PageLink, Page>({
    print,
    parse,
    normalize,
    pageLink: pageLinkArbitrary,
    page: pageArbitrary,
}: {
    print: (storage: AgentWebSessionStorage, pageLink: PageLink, page: Page) => Promise<Root>;
    parse: (
        storage: AgentWebSessionStorage,
        pageLink: PageLink | null,
        root: Root,
    ) => Promise<Page>;
    normalize: (page: Page) => Page;
    pageLink: Arbitrary<PageLink>;
    page: Arbitrary<Page>;
}) {
    import.meta.jest.setTimeout(15 * 1000);
    fc.configureGlobal({interruptAfterTimeLimit: 5 * 1000});

    const storage = createAgentWebSessionStorageForTest(apiContentArbitrarySpaceId);

    test("can parse exact same content that was printed", async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.record({pageLink: pageLinkArbitrary, page: pageArbitrary}),
                async ({pageLink, page}) => {
                    await storage.deleteAll();

                    const normalizedPage = normalize(page);

                    const markdown = await print(storage, pageLink, normalizedPage);

                    expect(
                        // We don't call `normalize()` on the parsed result since we assume `parse()` will
                        // return data in normalized format.
                        await parse(storage, pageLink, markdown),
                    ).toEqual(normalizedPage);
                },
            ),
            {
                // Run until we reach our 10s timeout.
                numRuns: Infinity,
            },
        );
    });
}
