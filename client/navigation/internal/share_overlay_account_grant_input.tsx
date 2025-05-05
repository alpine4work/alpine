import {CaretDown} from "phosphor-react";
import {Dispatch, Ref, SetStateAction, forwardRef, useCallback} from "react";
import {Button} from "~/client/design/button.js";
import {MenuAction} from "~/client/design/menu.js";
import {MenuButton} from "~/client/design/menu_button.js";
import {
    ShareOverlayAccountInput,
    ShareOverlayAccountInputRef,
} from "~/client/navigation/internal/share_overlay_account_input.js";
import {AccessLevel, AccessPolicy} from "~/shared/access/access_policy.js";
import {addRemLengths} from "~/shared/design/core/spacing.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

const ShareOverlayAccountGrantInputForwardRef = forwardRef(ShareOverlayAccountGrantInput);
export {ShareOverlayAccountGrantInputForwardRef as ShareOverlayAccountGrantInput};

function ShareOverlayAccountGrantInput(
    {
        accessLevelText,
        accountGrantById,
        allAccounts,
        accountById,
        isAltKeyDown,
        selectedAccounts,
        onSelectedAccountsChange,
        accessLevel,
        onAccessLevelChange,
    }: {
        accessLevelText: Record<AccessLevel, string>;
        accountGrantById: AccessPolicy["accountGrantById"];
        allAccounts: ReadonlyArray<AccountModel>;
        accountById: ReadonlyMap<AccountId, AccountModel>;
        isAltKeyDown: boolean;
        selectedAccounts: ReadonlyArray<AccountModel>;
        onSelectedAccountsChange: Dispatch<SetStateAction<ReadonlyArray<AccountModel>>>;
        accessLevel: AccessLevel;
        onAccessLevelChange: Dispatch<SetStateAction<AccessLevel>>;
    },
    ref: Ref<ShareOverlayAccountInputRef>,
) {
    return (
        <ShareOverlayAccountInput
            ref={ref}
            allAccounts={allAccounts}
            accountById={accountById}
            selectedAccounts={selectedAccounts}
            onSelectedAccountsChange={onSelectedAccountsChange}
            excludeAccountId={useCallback(
                (accountId: AccountId) => accountGrantById.has(accountId),
                [accountGrantById],
            )}
            buttons={
                <MenuButton
                    placement="bottom-end"
                    // Align this menu to the right edge of the input. So it's consistent with the
                    // access level menus from account grants. We can do this thanks to the add
                    // button's fixed width. This helps the design especially on mobile where
                    // otherwise the overlay is pushed to the right side of the screen.
                    offsetAlong={addRemLengths("2")}
                    actions={[
                        {
                            isSelected: accessLevel === "Manage",
                            label: accessLevelText.Manage,
                            onPress: () => onAccessLevelChange?.("Manage"),
                        },
                        ...(isAltKeyDown
                            ? [
                                  cast<MenuAction>({
                                      isSelected: accessLevel === "Edit",
                                      label: accessLevelText.Edit,
                                      onPress: () => onAccessLevelChange?.("Edit"),
                                  }),
                              ]
                            : emptyArray),
                        {
                            isSelected: accessLevel === "Comment",
                            label: accessLevelText.Comment,
                            onPress: () => onAccessLevelChange?.("Comment"),
                        },
                        {
                            isSelected: accessLevel === "View",
                            label: accessLevelText.View,
                            onPress: () => onAccessLevelChange?.("View"),
                        },
                    ]}
                >
                    <Button height="6" paddingX="2" icon={<CaretDown />} iconPlacement="end">
                        {accessLevelText[accessLevel]}
                    </Button>
                </MenuButton>
            }
        />
    );
}
