import {getAccountRegistry} from "~/client/accounts/account_registry_context.js";
import {getSearchEntityRegistry} from "~/client/search/core/search_entity_registry_context.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {ContentReferences} from "~/shared/content/content_references.js";
import {renderContentMentionToText} from "~/shared/content/render_content_mention_to_text.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {Store} from "~/shared/store/store.js";

export function renderContentMentionToTextForClient(
    get: <Value>(store: Store<Value>) => Value,
    spaceId: SpaceId,
    mention: ContentMention,
    references: ContentReferences,
): string {
    return renderContentMentionToText(mention, {
        getAccountIfExists: accountId => {
            const account = references.accountById.get(accountId);
            if (!account) return null;
            const accountData = get(getAccountRegistry(spaceId).getAccountStore(account));
            return accountData;
        },
        getSearchEntityIfExists: entityId => {
            const entity = references.searchEntityById.get(entityId);
            if (!entity) return null;
            if (entity.isPrivate) return entity;
            const entityData = get(getSearchEntityRegistry(spaceId).getEntityStore(entity.entity));
            return {isPrivate: false, title: entityData.title};
        },
    });
}
