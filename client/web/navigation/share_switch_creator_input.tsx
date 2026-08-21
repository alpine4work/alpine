import {ReactNode, useId} from "react";
import {usePress} from "react-aria";
import {Box} from "~/client/web/design/box.js";
import {ShareSwitchBase} from "~/client/web/navigation/share_switch_base.js";
import {useSpaceContext} from "~/client/web/spaces/context/space_context.js";
import {backgroundColorVar, colorSchemeVars, sprinkles} from "~/client/web/styles/styles.js";

export function ShareSwitchCreatorInput({
    isPublic,
    onIsPublicChange,
    label = "Share",
    entityNoun = "channel",
    publicTitle = "Public",
    publicSubtitle,
    privateTitle = "Private",
    privateSubtitle = "Only specific people",
}: {
    isPublic: boolean;
    onIsPublicChange: (isPublic: boolean) => void;
    /** Heading rendered above the two options. */
    label?: string;
    /** Noun used for the switch's tooltip / accessibility copy. */
    entityNoun?: string;
    publicTitle?: string;
    /** Defaults to "Everyone in {space name}". */
    publicSubtitle?: ReactNode;
    privateTitle?: string;
    privateSubtitle?: ReactNode;
}) {
    const {space} = useSpaceContext();

    const labelId = useId();

    return (
        <Box>
            <label
                id={labelId}
                className={sprinkles({
                    // `display: block; width: fit-content` is important here! As `inline-block`
                    // there's some weird additional vertical space underneath the label.
                    display: "block",
                    width: "fit-content",
                    maxWidth: "full",
                    fontSize: "75",
                    fontStyle: "semi-bold",
                    paddingBottom: "1.5",
                })}
            >
                {label}
            </label>
            <Box display="flex" flexDirection="column" gap="2">
                <ShareSwitchCreatorInputItem
                    isSelected={isPublic}
                    onPress={() => onIsPublicChange(true)}
                    switchIcon="Buildings"
                    entityNoun={entityNoun}
                    title={publicTitle}
                    subtitle={
                        publicSubtitle ?? (
                            <>
                                Everyone in{" "}
                                <span
                                    className={sprinkles({
                                        color: "grey-60",
                                        fontStyle: "semi-bold",
                                    })}
                                >
                                    {space.name}
                                </span>
                            </>
                        )
                    }
                />
                <ShareSwitchCreatorInputItem
                    isSelected={!isPublic}
                    onPress={() => onIsPublicChange(false)}
                    switchIcon="Lock"
                    entityNoun={entityNoun}
                    title={privateTitle}
                    subtitle={privateSubtitle}
                />
            </Box>
        </Box>
    );
}

function ShareSwitchCreatorInputItem({
    switchIcon,
    isSelected,
    onPress,
    entityNoun,
    title,
    subtitle,
}: {
    switchIcon: "Lock" | "Buildings";
    isSelected: boolean;
    onPress: () => void;
    entityNoun: string;
    title: string;
    subtitle: ReactNode;
}) {
    const {isPressed, pressProps} = usePress({onPress});

    return (
        <Box
            {...pressProps}
            position="relative"
            zIndex="0"
            flexGrow="1"
            padding="4"
            borderRadius="2"
            display="flex"
            alignItems="center"
            gap="4"
            boxShadow="elevation-5-with-grey-10-border"
            backgroundColor={isPressed ? "grey-5" : undefined}
        >
            <ShareSwitchBase isInert={true} entityNoun={entityNoun} icon={switchIcon} />
            <Box flexGrow="1" display="flex" alignItems="baseline" gap="1.5">
                <Box fontStyle="truncate" fontSize="75">
                    {title}
                </Box>
                <Box fontStyle="truncate" fontSize="50" color="grey-50">
                    {subtitle}
                </Box>
            </Box>
            <Box
                flexShrink="0"
                width="3"
                height="3"
                borderRadius="full"
                border={!isSelected ? "grey-20" : undefined}
                style={{
                    backgroundColor: isSelected ? colorSchemeVars["grey-90"] : undefined,
                    boxShadow: isSelected
                        ? `inset 0 0 0 1px ${colorSchemeVars["grey-90"]}, inset 0 0 0 3px ${backgroundColorVar}`
                        : undefined,
                }}
            />
        </Box>
    );
}
