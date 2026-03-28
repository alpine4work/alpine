import {Root} from "mdast";
import {
    AgentWebSessionStorage,
    AgentWebSessionStorageCollection,
} from "~/server/agents/web/agent_web_session_storage.js";
import {DurableObjectStorageCollection} from "~/server/cloudflare/durable_object_storage_collection.js";
import {TemporaryDurableObjectStorage} from "~/server/cloudflare/temporary_durable_object_storage.js";
import {normalizeApiContentResponse} from "~/shared/api/markdown/normalize_api_content.js";
import {parseMarkdownTree} from "~/shared/api/markdown/parse_api_content_from_markdown.js";
import {printMarkdownTree} from "~/shared/api/markdown/print_api_content_to_markdown.js";
import {ErrorBase, InternalError} from "~/shared/error/error.js";
import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.js";
import {Mutex} from "~/shared/helpers/async/mutex.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {generateOrderKeyBetween, initialOrderKey} from "~/shared/helpers/sort/order_key.js";
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
            newParseError?: string;
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
    const temporaryStorage = new TemporaryDurableObjectStorage();

    afterEach(async () => {
        await temporaryStorage.deleteAll();
    });

    let nextOrderKey = initialOrderKey;

    function createAgentWebSessionStorageCollection<
        Key extends string,
        Value,
    >(): AgentWebSessionStorageCollection<Key, Value> {
        const orderKey = nextOrderKey;
        nextOrderKey = generateOrderKeyBetween(nextOrderKey, null);

        const collection = new DurableObjectStorageCollection<Key, Value>(orderKey);

        return {
            get: collection.get.bind(collection, temporaryStorage),
            put: collection.put.bind(collection, temporaryStorage),
            list: collection.list.bind(collection, temporaryStorage),
        };
    }

    const storage: AgentWebSessionStorage = {
        spaceId: agentWebPageTestsSpaceId,
        mutex: new Mutex(),
        pageLinkByPath: createAgentWebSessionStorageCollection(),
        urlByTruncatedUrl: createAgentWebSessionStorageCollection(),
        dedupeNumberByTruncatedUrlAndUrl: createAgentWebSessionStorageCollection(),
        documentCommentThreadNumberById: createAgentWebSessionStorageCollection(),
        documentCommentThreadIdByNumber: createAgentWebSessionStorageCollection(),
        tableWidthByTruncatedWidth: createAgentWebSessionStorageCollection(),
        tableColumnWidthsByTruncatedColumnWidths: createAgentWebSessionStorageCollection(),
    };

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
            if (testCase.page) {
                const testCasePage = testCase.page;

                test("prints page to markdown", async () => {
                    expect(
                        printMarkdownTree(await print(storage, testCase.pageLink, testCasePage)),
                    ).toEqual(testCase.markdown);
                });
            }

            test("parses page from markdown", async () => {
                if (testCase.page) {
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
                if (!testCase.newParseError) {
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
                        testCase.parseError ?? "",
                    );
                }
            });
        });
    }
}
