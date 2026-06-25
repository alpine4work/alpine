import {Root} from "mdast";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {parseMarkdownTree} from "~/shared/api/content/parse_api_content_from_markdown.js";
import {printMarkdownTree} from "~/shared/api/content/print_api_content_to_markdown.js";
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
            createParseError?: string;
            setupStorage?: (storage: AgentWebSessionStorage) => Promise<void>;
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

                    let displayMessage: ErrorDisplayMessage;

                    if (error instanceof ErrorBase && error.displayMessage) {
                        displayMessage = error.displayMessage;
                    } else if (
                        error instanceof AggregateError &&
                        error.errors[0] instanceof ErrorBase &&
                        error.errors[0].displayMessage
                    ) {
                        // NOCOMMIT: Make sure tool calling code handles `displayMessage`s from
                        // `AggregateError`s!
                        //
                        // What I want is some kind of function to extract + print an error to a string for
                        // agents. I think this also means we need to replace any usages of `` ` `` in
                        // display messages with a custom code error display message segment that prints to
                        // inline code Markdown.
                        displayMessage = error.errors[0].displayMessage;
                    } else {
                        throw new InternalError(
                            "Expected `parse()` to throw an error with a `displayMessage`",
                            {cause: error},
                        );
                    }

                    expect(renderErrorDisplayMessage(displayMessage)).toEqual(
                        testCase.parseError ?? "",
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

                    let displayMessage: ErrorDisplayMessage;

                    if (error instanceof ErrorBase && error.displayMessage) {
                        displayMessage = error.displayMessage;
                    } else if (
                        error instanceof AggregateError &&
                        error.errors[0] instanceof ErrorBase &&
                        error.errors[0].displayMessage
                    ) {
                        // NOCOMMIT: Make sure tool calling code handles `displayMessage`s from
                        // `AggregateError`s!
                        //
                        // What I want is some kind of function to extract + print an error to a string for
                        // agents. I think this also means we need to replace any usages of `` ` `` in
                        // display messages with a custom code error display message segment that prints to
                        // inline code Markdown.
                        displayMessage = error.errors[0].displayMessage;
                    } else {
                        throw new InternalError(
                            "Expected `parse()` to throw an error with a `displayMessage`",
                            {cause: error},
                        );
                    }

                    expect(renderErrorDisplayMessage(displayMessage)).toEqual(
                        testCase.createParseError ?? testCase.parseError ?? "",
                    );
                }
            });
        });
    }
}
