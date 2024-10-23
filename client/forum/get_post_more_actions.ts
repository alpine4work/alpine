import {writeTextToClipboard} from "~/client/helpers/write_text_to_clipboard.js";
import {PostModel} from "~/shared/forum/post_model.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export function getPostMoreActions({
    currentAccount,
    post,
    onStartEditingPost,
}: {
    currentAccount: AccountModel;
    post: PostModel;
    onStartEditingPost: () => void;
}) {
    return [
        [
            {
                label: "Copy link",
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
        ...(currentAccount.id === post.author.id
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
