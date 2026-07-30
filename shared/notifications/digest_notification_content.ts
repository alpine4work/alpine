import {AccountModelDataWithSignedAvatarUrl} from "~/shared/spaces/account_model.js";

export type DigestNotificationContent = {
    inboxUrl: URL;
    digestEntries: Array<DigestEntry>;
    remainingEntryCount: number;
};

export type DigestEntry = {
    url: URL;
    title: Array<string | {type: "Account"; name: string}>;
    preview: string | null;
    brandIconType: string;
    time: Date;
    loudNotificationCount: number;
    featuredAccount: AccountModelDataWithSignedAvatarUrl;
    otherAccount?: AccountModelDataWithSignedAvatarUrl;
};
