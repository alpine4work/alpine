import {Root} from "mdast";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {normalizeApiContentResponse} from "~/shared/api/markdown/normalize_api_content.js";
import {parseMarkdownTree} from "~/shared/api/markdown/parse_api_content_from_markdown.js";
import {printMarkdownTree} from "~/shared/api/markdown/print_api_content_to_markdown.js";
import {ErrorBase, InternalError} from "~/shared/error/error.js";
import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {CommitBlocker} from "~/shared/helpers/types/commit_blocker.js";
import {generateId} from "~/shared/id/id.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

// This file can only be imported in Jest unit tests.
assert(import.meta.jest);

const agentWebPageTestsSpaceId = generateId<SpaceId>();

export function runAgentWebPageTests<PageLink, Page>({
    print,
    parse,
    tests: testCases,
}: {
    print: (storage: AgentWebSessionStorage, pageLink: PageLink, page: Page) => Promise<Root>;
    parse: (
        storage: AgentWebSessionStorage,
        pageLink: PageLink | null,
        root: Root,
    ) => Promise<Page>;
    tests: Array<
        {
            only?: CommitBlocker;
            name: string;
            pageLink: PageLink;
            markdown: string;
            printMarkdown?: string;
            createParseError?: string;
        } & (
            | {
                  page: Page;
                  parseError?: undefined;
              }
            | {
                  page?: undefined;
                  parseError: string;
              }
        )
    >;
}) {
    const storage = createAgentWebSessionStorageForTest(agentWebPageTestsSpaceId);

    function normalizePage(page: any): any {
        if ("content" in page) page = {...page, content: normalizeApiContentResponse(page.content)};
        return page;
    }

    function renderErrorDisplayMessage(displayMessage: ErrorDisplayMessage): string {
        let string = "";

        for (const segment of displayMessage) {
            switch (segment.type) {
                case "Text":
                    string += segment.text;
                    break;

                case "SensitiveText":
                    string += segment.text;
                    break;

                case "Link":
                    string += segment.text;
                    break;

                default:
                    throw exhaustive(segment);
            }
        }

        return string;
    }

    for (const testCase of testCases) {
        const describe = testCase.only ? globalThis.describe.only : globalThis.describe;

        describe(testCase.name, () => {
            if (typeof testCase.printMarkdown === "string") {
                test("print markdown doesn\u2019t equal markdown", () => {
                    expect(testCase.printMarkdown).not.toEqual(testCase.markdown);
                });
            }

            if (testCase.page) {
                const testCasePage = testCase.page;

                test("prints page to markdown", async () => {
                    expect(
                        printMarkdownTree(await print(storage, testCase.pageLink, testCasePage)),
                    ).toEqual(testCase.printMarkdown ?? testCase.markdown);
                });
            }

            test("parses page from markdown", async () => {
                if (testCase.page) {
                    // We must print the page first before we parse it so that any references are
                    // written to storage.
                    await print(storage, testCase.pageLink, testCase.page);

                    expect(
                        normalizePage(
                            await parse(
                                storage,
                                testCase.pageLink,
                                parseMarkdownTree(testCase.markdown),
                            ),
                        ),
                    ).toEqual(normalizePage(testCase.page));
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

                    if (!(error instanceof ErrorBase) || !error.displayMessage) {
                        throw new InternalError(
                            "Expected `parse()` to throw an error with a `displayMessage`",
                        );
                    }

                    expect(renderErrorDisplayMessage(error.displayMessage)).toEqual(
                        testCase.parseError ?? "",
                    );
                }
            });

            test("parses new page from markdown", async () => {
                if (!testCase.createParseError && !testCase.parseError) {
                    expect(
                        normalizePage(
                            await parse(storage, null, parseMarkdownTree(testCase.markdown)),
                        ),
                    ).toEqual(normalizePage(testCase.page));
                } else {
                    let error;
                    try {
                        await parse(storage, null, parseMarkdownTree(testCase.markdown));
                    } catch (actualError) {
                        error = actualError;
                    }

                    if (!(error instanceof ErrorBase) || !error.displayMessage) {
                        throw new InternalError(
                            "Expected `parse()` to throw an error with a `displayMessage`",
                        );
                    }

                    expect(renderErrorDisplayMessage(error.displayMessage)).toEqual(
                        testCase.parseError ?? testCase.createParseError ?? "",
                    );
                }
            });
        });
    }
}
