import {Fragment, useMemo} from "react";
import {AccountAvatarPile} from "~/client/accounts/account_avatar_pile";
import {AccountShortName} from "~/client/accounts/account_short_name";
import {Box} from "~/client/design/box";
import {useSpaceContext} from "~/client/spaces/space_context";
import {RemLength} from "~/shared/design/spacing";
import {interleaveArray} from "~/shared/helpers/array/interleave_array";
import {filterIterable} from "~/shared/helpers/iterable/filter_iterable";
import {AccountModel} from "~/shared/models/account_model";
import {sprinkles} from "~/shared/styles/styles";

export const chatViewHeaderHeight: RemLength = "7.375rem";

export function ChatViewHeader({accounts}: {accounts: ReadonlyArray<AccountModel>}) {
    const {currentAccount} = useSpaceContext();

    // Sort accounts in a reasonable order for presenting in the UI.
    //
    // NOTE(calebmer): Ideally this would be sorted by some kind of affinity score
    // but we don't have that yet.
    const otherAccounts = useMemo(
        () =>
            Array.from(filterIterable(accounts, account => account.id !== currentAccount.id)).sort(
                (a, b) => a.name.localeCompare(b.name),
            ),
        [accounts, currentAccount.id],
    );

    return (
        <Box
            position="absolute"
            left="0"
            right="0"
            bottom="0"
            style={{height: chatViewHeaderHeight}}
        >
            {otherAccounts.length > 0 && (
                <Box paddingX="5" paddingY="5">
                    <AccountAvatarPile
                        size="lg"
                        previewAccounts={otherAccounts.slice(0, 5)}
                        accountCount={otherAccounts.length}
                        getAllAccounts={() => otherAccounts}
                    />
                    <Box paddingTop="3" fontSize="100" fontStyle="truncate" color="grey-70">
                        Start a private conversation between you
                        {otherAccounts.length === 1 ? (
                            <>
                                {" "}
                                and{" "}
                                <strong
                                    className={sprinkles({
                                        fontStyle: "semi-bold",
                                        color: "grey-text",
                                    })}
                                >
                                    <AccountShortName account={otherAccounts[0]!} />
                                </strong>
                            </>
                        ) : otherAccounts.length > 1 ? (
                            <>
                                ,{" "}
                                {interleaveArray(
                                    otherAccounts.slice(0, -1).map(account => (
                                        <strong
                                            key={account.id}
                                            className={sprinkles({
                                                fontStyle: "semi-bold",
                                                color: "grey-text",
                                            })}
                                        >
                                            <AccountShortName account={account} />
                                        </strong>
                                    )),
                                    index => (
                                        <Fragment key={index}>, </Fragment>
                                    ),
                                )}
                                , and{" "}
                                <strong
                                    className={sprinkles({
                                        fontStyle: "semi-bold",
                                        color: "grey-text",
                                    })}
                                >
                                    <AccountShortName
                                        account={otherAccounts[otherAccounts.length - 1]!}
                                    />
                                </strong>
                            </>
                        ) : null}
                    </Box>
                </Box>
            )}
        </Box>
    );
}
