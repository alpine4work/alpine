import {AccountRegistry} from "~/client/accounts/account_registry.js";
import {FileRegistry} from "~/client/content/file_registry.js";
import {getContentReferencesForClientPrintSingleLineTextSnippet} from "~/client/content/print_content_single_line_text_snippet_for_client.js";
import {SearchEntityRegistry} from "~/client/search/core/search_entity_registry.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {ContentReferences} from "~/shared/content/content_references.js";
import {renderContentMentionToText} from "~/shared/content/render_content_mention_to_text.js";
import {Store} from "~/shared/store/store.js";

export function renderContentMentionToTextForClient(
    get: <Value>(store: Store<Value>) => Value,
    mention: ContentMention,
    references: ContentReferences,
    options: {
        accountRegistry: AccountRegistry;
        searchEntityRegistry: SearchEntityRegistry;
        fileRegistry: FileRegistry;
    },
): string {
    return renderContentMentionToText(
        mention,
        getContentReferencesForClientPrintSingleLineTextSnippet(get, references, options),
    );
}
