import {useMemo} from "react";
import {AccountAvatarPile} from "~/client/web/accounts/account_avatar_pile.js";
import {AccountShortName} from "~/client/web/accounts/account_short_name.js";
import {Box} from "~/client/web/design/box.js";
import {PrettyConjunctionList} from "~/client/web/design/pretty_conjunction_list.js";
import {Color} from "~/shared/design/core/colors.js";
import {FontSize} from "~/shared/design/core/fonts.js";
import {DocumentHistoryAuthor} from "~/shared/documents/document_history_model.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

const documentHistoryContributorNameLimit = 3;
const documentHistoryContributorNamePreviewLimit = documentHistoryContributorNameLimit - 1;

export function DocumentHistoryContributors({
    authors,
    accountById,
    fontSize = "75",
    color = "grey-70",
}: {
    authors: ReadonlyArray<DocumentHistoryAuthor>;
    accountById: ReadonlyMap<AccountId, AccountModel>;
    fontSize?: FontSize;
    color?: Color;
}) {
    const contributorAccounts = useMemo(() => {
        const contributorAccountById = new Map<AccountId, AccountModel>();

        for (const author of authors) {
            const accountId = getDocumentHistoryContributorAvatarAccountId(author);
            const account = accountId ? accountById.get(accountId) : undefined;
            if (account) contributorAccountById.set(account.id, account);
        }

        return Array.from(contributorAccountById.values());
    }, [accountById, authors]);
    const visibleNameCount = Math.min(
        contributorAccounts.length,
        contributorAccounts.length <= documentHistoryContributorNameLimit
            ? documentHistoryContributorNameLimit
            : documentHistoryContributorNamePreviewLimit,
    );
    const remainingAccountCount = contributorAccounts.length - visibleNameCount;
    const previewAccounts = contributorAccounts.slice(0, visibleNameCount);

    return (
        <Box width="full" minWidth="0" display="flex" alignItems="center" gap="1.5" color={color}>
            <AccountAvatarPile size="3" previewAccounts={previewAccounts} />
            <Box
                flexGrow="1"
                minWidth="0"
                overflow="hidden"
                fontSize={fontSize}
                fontStyle="truncate"
            >
                <PrettyConjunctionList
                    list={[
                        ...contributorAccounts
                            .slice(0, visibleNameCount)
                            .map(account => (
                                <AccountShortName key={account.id} account={account} />
                            )),
                        ...(remainingAccountCount > 0 ? [`${remainingAccountCount} more`] : []),
                    ]}
                />
            </Box>
        </Box>
    );
}

function getDocumentHistoryContributorAvatarAccountId(
    author: DocumentHistoryAuthor,
): AccountId | null {
    if (author.from?.type === "Bot") {
        // TODO(#bot-attribution): Show the human author when a bot acts on their behalf.
        return author.from.accountId;
    }
    return author.id;
}
