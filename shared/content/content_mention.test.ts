import {AccountId, ContentMentionAccountId} from "~/shared/id/types/id_types.js";

test("`AccountId`s are `ContentMentionAccountId`s", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    function testTypes(id: AccountId): ContentMentionAccountId {
        return id;
    }
});

test("`ContentMentionAccountId`s are not `AccountId`s", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    function testType(id: ContentMentionAccountId): AccountId {
        // @ts-expect-error: Should not be assignable
        return id;
    }
});
