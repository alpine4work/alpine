import {themeColors} from "~/shared/design/core/theme_colors.js";
import {compareHybridLogicalTimes} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {HybridLogicalTimeSchema} from "~/shared/schema/helpers/hybrid_logical_time_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export type SearchEntityMediaModel = SchemaType<typeof SearchEntityMediaModelSchema>;

export const SearchEntityAccountMediaModelSchema = Schema.object({
    type: Schema.value("Account"),
    account: AccountModel.schema,
});

export const SearchEntityAccountPileMediaModelSchema = Schema.object({
    type: Schema.value("AccountPile"),
    previewAccounts: Schema.array(AccountModel.schema).minLength(1),
    accountCount: Schema.integer,
});

export const SearchEntityTaskCollectionColorMediaModelSchema = Schema.object({
    type: Schema.value("TaskCollectionColor"),
    color: Schema.enum(themeColors).nullable(),
    version: HybridLogicalTimeSchema,
});

export const SearchEntityTaskDisplayStatusMediaModelSchema = Schema.object({
    type: Schema.value("TaskDisplayStatus"),
    displayStatus: Schema.enum(["OpenInactive", "OpenActive", "Closed"]),
    version: HybridLogicalTimeSchema,
});

export const SearchEntityMediaModelSchema = Schema.union({
    Account: SearchEntityAccountMediaModelSchema,
    AccountPile: SearchEntityAccountPileMediaModelSchema,
    TaskCollectionColor: SearchEntityTaskCollectionColorMediaModelSchema,
    TaskDisplayStatus: SearchEntityTaskDisplayStatusMediaModelSchema,
});

/**
 * Merge two search entity medias together. Each media carries its own
 * product-specific version information we use to figure out which media should
 * win.
 *
 * This is not commutative like a CRDT merge function (e.g.
 * `TaskModel.merge()`). We prefer data from `oldMedia` when the media are
 * equal. We prefer `newMedia` when there's insufficient version information to
 * pick a winner.
 *
 * You should generally pass in the older data into `oldMedia` and newer data
 * to `newMedia`. So we avoid unnecessary re-renders when the data is equal
 * (and `oldMedia` is preferred) and in case we don't have clear version
 * information we prefer the newer data (`newMedia`).
 */
export function mergeSearchEntityMediaModel(
    oldMedia: SearchEntityMediaModel | null,
    newMedia: SearchEntityMediaModel | null,
): SearchEntityMediaModel | null {
    if (oldMedia === null || newMedia === null) return newMedia;

    switch (newMedia.type) {
        case "Account": {
            if (oldMedia.type !== newMedia.type) return newMedia;

            const mergedAccount = oldMedia.account.merge(newMedia.account);
            if (mergedAccount === oldMedia.account) return oldMedia;
            if (mergedAccount === newMedia.account) return newMedia;

            return {type: "Account", account: mergedAccount};
        }
        case "AccountPile": {
            if (oldMedia.type !== newMedia.type) return newMedia;

            let hasNewMediaChanged = false;

            const mergedPreviewAccounts = newMedia.previewAccounts.map(newAccount => {
                const oldAccount = oldMedia.previewAccounts.find(
                    oldAccount => oldAccount.id === newAccount.id,
                );
                if (!oldAccount) return newAccount;

                const mergedAccount = oldAccount.merge(newAccount);
                if (mergedAccount === newAccount) return newAccount;

                hasNewMediaChanged = true;
                return mergedAccount;
            });

            // If `newMedia` is exactly equal to `oldMedia` then return `oldMedia` to
            // reduce re-renders.
            if (
                oldMedia.accountCount === newMedia.accountCount &&
                oldMedia.previewAccounts.length === newMedia.previewAccounts.length &&
                mergedPreviewAccounts.every((account, i) => account === oldMedia.previewAccounts[i])
            ) {
                return oldMedia;
            }

            if (!hasNewMediaChanged) return newMedia;

            return {
                type: "AccountPile",
                previewAccounts: mergedPreviewAccounts,
                accountCount: newMedia.accountCount,
            };
        }
        case "TaskCollectionColor":
        case "TaskDisplayStatus": {
            if (oldMedia.type !== newMedia.type) return newMedia;

            const compare = compareHybridLogicalTimes(oldMedia.version, newMedia.version);
            if (compare >= 0) return oldMedia;
            return newMedia;
        }
        default:
            throw exhaustive(newMedia);
    }
}
