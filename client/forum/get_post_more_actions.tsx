import {Link as LinkIcon} from "phosphor-react";
import {MenuAction} from "~/client/design/menu.js";
import {writeTextToClipboard} from "~/client/helpers/write_text_to_clipboard.js";
import {NavigateFunction} from "~/client/remix/use_navigate.js";
import {PostModel} from "~/shared/forum/post_model.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export function getPostMoreActions({
    currentAccount,
    post,
    navigate,
    onStartEditingPost,
}: {
    currentAccount: AccountModel | null;
    post: PostModel;
    navigate: NavigateFunction;
    onStartEditingPost: () => void;
}): Array<Array<MenuAction>> {
    return [
        [
            {
                label: "Copy link",
                icon: <LinkIcon />,
                iconPlacement: "end",
                pressErrorTitle: "Couldn’t copy post link",
                onPress: async () => {
                    const url = new URL(
                        `/s/${post.spaceId}/posts/${post.id}`,
                        window.location.href,
                    );
                    await writeTextToClipboard(url.toString());
                },
            },
        ],
        [
            {
                label: "See likes",
                pressErrorTitle: "Couldn’t open likes",
                onPress: async () => {
                    await navigate(`/s/${post.spaceId}/posts/${post.id}/reactions`);
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
