import {Nodes, Root} from "mdast";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.open_source.js";
import {printAgentWebError} from "~/server/agents/web/print_agent_web_error.open_source.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {parseMarkdownTree} from "~/shared/api/content/parse_api_content_from_markdown.open_source.js";
import {printMarkdownTree} from "~/shared/api/content/print_api_content_to_markdown.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {PrettyMarkdown} from "~/shared/helpers/string/markdown.js";
import {CommitBlocker} from "~/shared/helpers/types/commit_blocker.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";

// This file can only be imported in Jest unit tests.
assert(import.meta.jest);

const agentWebPageTestsSpaceId = generateId<SpaceId>();

export function runAgentWebPageTests<PageLink, Page>({
    print,
    parse,
    normalize,
    tests: testCases,
}: {
    print: (storage: AgentWebSessionStorage, pageLink: PageLink, page: Page) => Promise<Root>;
    parse: (
        storage: AgentWebSessionStorage,
        pageLink: PageLink | null,
        root: Root,
    ) => Promise<Page>;
    normalize: (page: Page) => Page;
    tests: Array<
        {
            only?: CommitBlocker;
            name: string;
            pageLink: PageLink;
            markdown: string;
            printMarkdown?: string;
            createParseError?: PrettyMarkdown;
            setupStorage?: (storage: AgentWebSessionStorage) => Promise<void>;
        } & (
            | {
                  page: Page;
                  parseError?: undefined;
              }
            | {
                  page?: undefined;
                  parseError: PrettyMarkdown;
              }
        )
    >;
}) {
    const storage = createAgentWebSessionStorageForTest(agentWebPageTestsSpaceId);

    for (const testCase of testCases) {
        const describe = testCase.only ? globalThis.describe.only : globalThis.describe;

        const normalizedTestCasePage = testCase.page ? normalize(testCase.page) : null;

        describe(testCase.name, () => {
            if (typeof testCase.printMarkdown === "string") {
                test("print markdown doesn\u2019t equal markdown", () => {
                    expect(testCase.printMarkdown).not.toEqual(testCase.markdown);
                });
            }

            if (normalizedTestCasePage) {
                test("prints page to markdown", async () => {
                    expect(
                        printMarkdownTree(
                            await print(storage, testCase.pageLink, normalizedTestCasePage),
                        ),
                    ).toEqual(testCase.printMarkdown ?? testCase.markdown);
                });
            }

            test("parses page from markdown", async () => {
                if (testCase.setupStorage) await testCase.setupStorage(storage);

                if (normalizedTestCasePage) {
                    // We must print the page first before we parse it so that any references are
                    // written to storage.
                    await print(storage, testCase.pageLink, normalizedTestCasePage);

                    expect(
                        // We don't call `normalize()` on the parsed result since we assume `parse()` will
                        // return data in normalized format.
                        await parse(
                            storage,
                            testCase.pageLink,
                            parseMarkdownTree(testCase.markdown),
                        ),
                    ).toEqual(normalizedTestCasePage);
                } else {
                    let error;
                    try {
                        await parse(
                            storage,
                            testCase.pageLink,
                            parseMarkdownTree(testCase.markdown),
                        );
                    } catch (actualError) {
                        error = actualError;
                    }

                    expect(printAgentWebError("", error)).toEqual(
                        printPrettyAgentWebPageTestError(testCase.parseError ?? ""),
                    );
                }
            });

            test("parses new page from markdown", async () => {
                if (testCase.setupStorage) await testCase.setupStorage(storage);

                if (!testCase.createParseError && normalizedTestCasePage) {
                    // We must print the page first before we parse it so that any references are
                    // written to storage.
                    await print(storage, testCase.pageLink, normalizedTestCasePage);

                    expect(
                        // We don't call `normalize()` on the parsed result since we assume `parse()` will
                        // return data in normalized format.
                        await parse(storage, null, parseMarkdownTree(testCase.markdown)),
                    ).toEqual(normalizedTestCasePage);
                } else {
                    let error;
                    try {
                        await parse(storage, null, parseMarkdownTree(testCase.markdown));
                    } catch (actualError) {
                        error = actualError;
                    }

                    expect(printAgentWebError("", error)).toEqual(
                        printPrettyAgentWebPageTestError(
                            testCase.createParseError ?? testCase.parseError ?? "",
                        ),
                    );
                }
            });
        });
    }
}

function printPrettyAgentWebPageTestError(markdown: string): string {
    const root = parseMarkdownTree(markdown);
    const nodes: Array<Nodes> = [root];

    for (const node of nodes) {
        if (node.type === "text") {
            node.value = node.value.replaceAll(/\s*\n\s*/g, " ");
        } else if ("children" in node) {
            for (const childNode of node.children) nodes.push(childNode);
        }
    }

    return printMarkdownTree(root).trimEnd();
}
