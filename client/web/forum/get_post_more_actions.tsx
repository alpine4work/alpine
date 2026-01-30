import {Link as LinkIcon} from "phosphor-react";
import {MenuAction} from "~/client/web/design/menu.js";
import {writeTextToClipboard} from "~/client/web/helpers/write_text_to_clipboard.js";
import {PostModel} from "~/shared/forum/post_model.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export function getPostMoreActions({
    currentAccount,
    post,
    onStartEditingPost,
}: {
    currentAccount: AccountModel | null;
    post: PostModel;
    onStartEditingPost: () => void;
}): Array<Array<MenuAction>> {
    return [
        [
            {
                label: "Copy link",
                icon: <LinkIcon />,
                iconPlacement: "end",
                pressErrorTitle: "Couldn\u2019t copy post link",
                onPress: async () => {
                    const url = new URL(
                        `/s/${post.spaceId}/posts/${post.id}`,
                        window.location.href,
                    );
                    await writeTextToClipboard(url.toString());
                },
            },
        ],
        ...(currentAccount?.id === post.author.id
            ? [
                  [
                      {
                          label: "Edit",
                          onPress: onStartEditingPost,
                      },
                  ],
              ]
            : []),
    ];
}
