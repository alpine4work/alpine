import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {Modal} from "~/client/web/design/modal.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {SpaceInviteContent} from "~/client/web/spaces/layout/space_invite_content.js";
import {SpaceAvatar} from "~/client/web/spaces/space_avatar.js";
import {neverPromise} from "~/shared/helpers/async/never_promise.js";
import {
    acceptSpaceAccountInvite,
    rejectSpaceAccountInviteAsSpam,
} from "~/shared/rpc/spaces_rpc_definitions.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";

export function SpaceInviteDecisionModal({
    allAccounts,
    currentAccount,
    space,
    onClose,
    onRejected,
}: {
    allAccounts: ReadonlyArray<AccountModel>;
    currentAccount: AccountModel;
    space: SpaceModel;
    onClose: () => void;
    onRejected: () => void;
}) {
    const context = useAppContext();

    return (
        <Modal
            aria-label={`Join ${space.name}?`}
            maxWidth="96"
            onClose={onClose}
            withoutCloseButton
        >
            <Box padding="12">
                <SpaceAvatar space={space} size="10" />
                <Spacer space="6" />
                <SpaceInviteContent
                    allAccounts={allAccounts}
                    currentAccount={currentAccount}
                    space={space}
                    variant="Modal"
                    onAcceptInvite={async () => {
                        await acceptSpaceAccountInvite(context, {spaceId: space.id});

                        // We must perform a full page navigation when switching spaces in order to reload
                        // the `_space` route with a new `SpaceId`. We can't currently perform single page
                        // navigation to a new space because the `_space` route must run in parallel with
                        // some other loaders and currently Remix makes a network request for each
                        // individual loader on single page navigation.
                        window.location.assign(`/home/${space.id}`);
                        await neverPromise;
                    }}
                    onReportAsSpam={async () => {
                        await rejectSpaceAccountInviteAsSpam(context, {spaceId: space.id});
                        onRejected();
                    }}
                />
            </Box>
        </Modal>
    );
}
