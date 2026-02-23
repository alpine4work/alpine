import {documentsInjection} from "~/server/documents/data/documents_injection.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {TestPost} from "~/server/forum/test_helpers/test_post.js";
import {getSearchMentionEntityIfPossible} from "~/server/search/data/index/search_entity_index.js";
import {searchInjection} from "~/server/search/data/index/search_injection.js";
import {TestActionContext} from "~/server/spaces/test_helpers/test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {SearchMentionEntityId} from "~/shared/search/search_entity_id.js";

import.meta.jest.useFakeTimers();

const context = createTestContext({
    shouldStartOpensearch: true,
    documentsInjection,
    searchInjection,
});

describe("User access to search entities based on urlGrant and context", () => {
    /*
     * Tests for search mention entity types: Document, Channel, and Post.
     * TaskCollection and Task tests are not included due to TaskRealtimeService
     * dependency limitations in unit tests.
     */
    type TestParams = {
        urlGrantLevel: "View" | null;
        defaultGrantType: "Space" | null;
        grantedIndividualAccess: boolean;
        expectedAccess: boolean;
    };

    type ContextType = "Anonymous" | "Account";
    type EntityType = "Document" | "Channel" | "Post";

    const testCases: Record<ContextType, Record<EntityType, Array<TestParams>>> = {
        Anonymous: {
            Document: [
                {
                    urlGrantLevel: null,
                    defaultGrantType: null,
                    grantedIndividualAccess: false,
                    expectedAccess: false,
                },
                {
                    urlGrantLevel: null,
                    defaultGrantType: "Space",
                    grantedIndividualAccess: false,
                    expectedAccess: false,
                },
                {
                    urlGrantLevel: "View",
                    defaultGrantType: "Space",
                    grantedIndividualAccess: false,
                    expectedAccess: true,
                },
                {
                    urlGrantLevel: "View",
                    defaultGrantType: null,
                    grantedIndividualAccess: false,
                    expectedAccess: true,
                },
            ],
            Channel: [
                {
                    urlGrantLevel: null,
                    defaultGrantType: null,
                    grantedIndividualAccess: false,
                    expectedAccess: false,
                },
                {
                    urlGrantLevel: null,
                    defaultGrantType: "Space",
                    grantedIndividualAccess: false,
                    expectedAccess: false,
                },
                {
                    urlGrantLevel: "View",
                    defaultGrantType: null,
                    grantedIndividualAccess: false,
                    expectedAccess: true,
                },
                {
                    urlGrantLevel: "View",
                    defaultGrantType: "Space",
                    grantedIndividualAccess: false,
                    expectedAccess: true,
                },
            ],
            Post: [
                {
                    urlGrantLevel: null,
                    defaultGrantType: null,
                    grantedIndividualAccess: false,
                    expectedAccess: false,
                },
                {
                    urlGrantLevel: null,
                    defaultGrantType: "Space",
                    grantedIndividualAccess: false,
                    expectedAccess: false,
                },
                {
                    urlGrantLevel: "View",
                    defaultGrantType: null,
                    grantedIndividualAccess: false,
                    expectedAccess: true,
                },
                {
                    urlGrantLevel: "View",
                    defaultGrantType: "Space",
                    grantedIndividualAccess: false,
                    expectedAccess: true,
                },
            ],
        },
        Account: {
            Document: [
                {
                    urlGrantLevel: null,
                    defaultGrantType: null,
                    grantedIndividualAccess: false,
                    expectedAccess: false,
                },
                {
                    urlGrantLevel: null,
                    defaultGrantType: null,
                    grantedIndividualAccess: false,
                    expectedAccess: false,
                },
                {
                    urlGrantLevel: null,
                    defaultGrantType: "Space",
                    grantedIndividualAccess: false,
                    expectedAccess: true,
                },
                {
                    urlGrantLevel: "View",
                    defaultGrantType: "Space",
                    grantedIndividualAccess: false,
                    expectedAccess: true,
                },
                {
                    urlGrantLevel: "View",
                    defaultGrantType: null,
                    grantedIndividualAccess: false,
                    expectedAccess: true,
                },
                {
                    urlGrantLevel: null,
                    defaultGrantType: null,
                    grantedIndividualAccess: true,
                    expectedAccess: true,
                },
            ],
            Channel: [
                {
                    urlGrantLevel: null,
                    defaultGrantType: "Space",
                    grantedIndividualAccess: false,
                    expectedAccess: true,
                },
                {
                    urlGrantLevel: null,
                    defaultGrantType: "Space",
                    grantedIndividualAccess: true,
                    expectedAccess: true,
                },
                {
                    urlGrantLevel: null,
                    defaultGrantType: null,
                    grantedIndividualAccess: true,
                    expectedAccess: true,
                },
            ],
            Post: [
                {
                    urlGrantLevel: null,
                    defaultGrantType: "Space",
                    grantedIndividualAccess: false,
                    expectedAccess: true,
                },
                {
                    urlGrantLevel: null,
                    defaultGrantType: "Space",
                    grantedIndividualAccess: true,
                    expectedAccess: true,
                },
                {
                    urlGrantLevel: null,
                    defaultGrantType: null,
                    grantedIndividualAccess: true,
                    expectedAccess: true,
                },
            ],
        },
    };

    async function runTest(
        contextType: ContextType,
        entityType: EntityType,
        testParams: TestParams,
    ) {
        const {urlGrantLevel, defaultGrantType, grantedIndividualAccess, expectedAccess} =
            testParams;

        const space = await TestSpace.create(context);
        const session = await space.createSession();

        let entityId: SearchMentionEntityId;
        let entity: TestDocument | TestChannel | TestPost;
        let accessTarget: TestDocument | TestChannel;
        let accountSession: TestSpaceSession | null = null;

        // Create account session if needed for individual access or account context
        if (contextType === "Account" || grantedIndividualAccess) {
            accountSession = await space.createSession();
        }

        // Create the appropriate entity type
        let channel: TestChannel | null = null;
        switch (entityType) {
            case "Document": {
                entity = await TestDocument.create(session);
                accessTarget = entity;
                entityId = `Document:${entity.id}`;
                break;
            }
            case "Channel": {
                entity = await TestChannel.create(session, {name: "Test Channel"});
                accessTarget = entity;
                entityId = `Channel:${entity.id}`;
                break;
            }
            case "Post": {
                channel = await TestChannel.create(session, {name: "Test Channel"});
                accessTarget = channel;
                entity = await channel.createPost(session, {});
                entityId = `Post:${entity.id}`;
                break;
            }
            default:
                throw exhaustive(entityType);
        }

        if (urlGrantLevel && accessTarget.access) {
            await accessTarget.access.grantUrl(session, urlGrantLevel);
        }

        if (defaultGrantType === "Space" && accessTarget.access) {
            await accessTarget.access.grantDefault(session);
        }

        if (grantedIndividualAccess && accountSession && accessTarget.access) {
            await accessTarget.access.grant(session, accountSession);
        }

        // Create the appropriate action context based on test case
        let actionContext: TestActionContext;
        switch (contextType) {
            case "Anonymous":
                actionContext = context.anonymousAction();
                break;
            case "Account":
                actionContext = accountSession!.action();
                break;
            default:
                throw exhaustive(contextType);
        }

        // Test access with the specified context
        const result = await getSearchMentionEntityIfPossible(actionContext, space.id, entityId);

        if (expectedAccess) {
            expect(result).not.toBeNull();
            expect(result?.isPrivate).toBe(false);
            // @ts-expect-error
            expect(result?.entity).toBeDefined();
        } else {
            expect(result).toEqual({isPrivate: true});
        }
    }

    // Generate tests from nested structure
    for (const contextType of Object.keys(testCases) as Array<ContextType>) {
        for (const entityType of Object.keys(testCases[contextType]) as Array<EntityType>) {
            const entityTestCases = testCases[contextType][entityType];

            entityTestCases.forEach(testParams => {
                const {urlGrantLevel, defaultGrantType, grantedIndividualAccess, expectedAccess} =
                    testParams;

                test(`${contextType} actor does ${
                    expectedAccess ? "" : "not "
                }have access to ${entityType} with urlGrant: ${urlGrantLevel}, defaultGrant: ${defaultGrantType}, individualAccess: ${grantedIndividualAccess}`, async () => {
                    await runTest(contextType, entityType, testParams);
                });
            });
        }
    }

    describe("Additional edge cases", () => {
        test("Anonymous user can access multiple documents with urlGrant simultaneously", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const document1 = await TestDocument.create(session);
            const document2 = await TestDocument.create(session);

            // Grant URL access to both documents
            await Promise.all([
                document1.access.grantUrl(session, "View"),
                document2.access.grantUrl(session, "View"),
            ]);

            // Test access to both documents
            const [doc1Result, doc2Result] = await Promise.all([
                getSearchMentionEntityIfPossible(
                    context.anonymousAction(),
                    space.id,
                    `Document:${document1.id}`,
                ),
                getSearchMentionEntityIfPossible(
                    context.anonymousAction(),
                    space.id,
                    `Document:${document2.id}`,
                ),
            ]);

            expect(doc1Result).not.toBeNull();
            expect(doc2Result).not.toBeNull();
            expect(doc1Result?.isPrivate).toBe(false);
            expect(doc2Result?.isPrivate).toBe(false);
        });

        test("Anonymous user cannot access entity where urlGrant was revoked", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const document = await TestDocument.create(session);

            // First grant URL access
            await document.access.grantUrl(session, "View");

            // Verify access works
            let result = await getSearchMentionEntityIfPossible(
                context.anonymousAction(),
                space.id,
                `Document:${document.id}`,
            );
            expect(result).not.toBeNull();
            expect(result?.isPrivate).toBe(false);

            // Revoke URL access
            await document.access.revokeUrl(session);

            // Verify access is denied
            result = await getSearchMentionEntityIfPossible(
                context.anonymousAction(),
                space.id,
                `Document:${document.id}`,
            );
            expect(result).toEqual({isPrivate: true});
        });

        test("Mixed access scenario - one document with urlGrant, one without", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const publicDocument = await TestDocument.create(session);
            const privateDocument = await TestDocument.create(session);

            // Grant URL access to only one document
            await publicDocument.access.grantUrl(session, "View");

            // Test access to both documents
            const [publicResult, privateResult] = await Promise.all([
                getSearchMentionEntityIfPossible(
                    context.anonymousAction(),
                    space.id,
                    `Document:${publicDocument.id}`,
                ),
                getSearchMentionEntityIfPossible(
                    context.anonymousAction(),
                    space.id,
                    `Document:${privateDocument.id}`,
                ),
            ]);

            // Public document should be accessible
            expect(publicResult).not.toBeNull();
            expect(publicResult?.isPrivate).toBe(false);

            // Private document should not be accessible
            expect(privateResult).toEqual({isPrivate: true});
        });

        test("Document with urlGrant vs entities without urlGrant", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            // Create entities - one with urlGrant, others without
            const document = await TestDocument.create(session);
            const channel = await TestChannel.create(session, {name: "Test Channel"});
            const post = await channel.createPost(session, {});

            // Grant URL access to document (channel and post do not have urlGrant)
            await document.access.grantUrl(session, "View");

            // Test access to all entities
            const [docResult, channelResult, postResult] = await Promise.all([
                getSearchMentionEntityIfPossible(
                    context.anonymousAction(),
                    space.id,
                    `Document:${document.id}`,
                ),
                getSearchMentionEntityIfPossible(
                    context.anonymousAction(),
                    space.id,
                    `Channel:${channel.id}`,
                ),
                getSearchMentionEntityIfPossible(
                    context.anonymousAction(),
                    space.id,
                    `Post:${post.id}`,
                ),
            ]);

            // Document with urlGrant should be accessible
            expect(docResult).not.toBeNull();
            expect(docResult?.isPrivate).toBe(false);

            // Entities without urlGrant support should not be accessible
            expect(channelResult).toEqual({isPrivate: true});
            expect(postResult).toEqual({isPrivate: true});
        });
    });
});
