import {CaretDown} from "phosphor-react";
import {useState} from "react";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {MenuAction} from "~/client/design/menu.js";
import {MenuButton} from "~/client/design/menu_button.js";
import {useResizeObserver} from "~/client/helpers/use_resize_observer.js";
import {accessLevelText} from "~/client/navigation/internal/access_level_text.js";
import {useSpacingScale} from "~/client/remix/spacing_scale_context.js";
import {pointerEventsNoneNotInheritedClassName, sprinkles} from "~/client/styles/styles.js";
import {AccessLevel} from "~/shared/access/access_policy.js";
import {convertRemLengthToPx} from "~/shared/design/core/spacing.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {cast} from "~/shared/helpers/control/cast.js";

export function ShareOverlayAccountGrantInput({isAltKeyDown}: {isAltKeyDown: boolean}) {
    const spacingScale = useSpacingScale();

    const [buttonsRef, buttonsSize] = useResizeObserver();

    const [accessLevel, setAccessLevel] = useState<AccessLevel>("Manage");

    return (
        <Box position="relative" height="10">
            <input
                className={sprinkles({
                    height: "full",
                    width: "full",
                    paddingLeft: "3",
                    border: "grey-20",
                    borderRadius: "1.5",
                    backgroundColor: "transparent",
                })}
                style={{
                    paddingRight:
                        (buttonsSize?.width ?? 0) + convertRemLengthToPx("2", spacingScale),
                }}
                placeholder="Add people"
            />
            <Box
                ref={buttonsRef}
                className={pointerEventsNoneNotInheritedClassName}
                position="absolute"
                top="0"
                bottom="0"
                right="2"
                display="flex"
                alignItems="center"
                gap="2"
            >
                <MenuButton
                    placement="bottom-end"
                    actions={[
                        {
                            isSelected: accessLevel === "Manage",
                            label: accessLevelText.Manage,
                            onPress: () => setAccessLevel("Manage"),
                        },
                        ...(isAltKeyDown
                            ? [
                                  cast<MenuAction>({
                                      isSelected: accessLevel === "Edit",
                                      label: accessLevelText.Edit,
                                      onPress: () => setAccessLevel("Edit"),
                                  }),
                              ]
                            : emptyArray),
                        {
                            isSelected: accessLevel === "Comment",
                            label: accessLevelText.Comment,
                            onPress: () => setAccessLevel("Comment"),
                        },
                        {
                            isSelected: accessLevel === "View",
                            label: accessLevelText.View,
                            onPress: () => setAccessLevel("View"),
                        },
                    ]}
                >
                    <Button height="6" paddingX="2" icon={<CaretDown />} iconPlacement="end">
                        {accessLevelText[accessLevel]}
                    </Button>
                </MenuButton>
                <Button variant="neutral" height="6" paddingX="3" withoutMinWidth>
                    Add
                </Button>
            </Box>
        </Box>
    );
}
