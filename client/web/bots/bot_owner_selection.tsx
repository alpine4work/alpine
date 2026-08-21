import {Box} from "~/client/web/design/box.js";
import {colorSchemeVars, sprinkles} from "~/client/web/styles/styles.js";

export function BotOwnerSelection({
    spaceName,
    botOwnerType,
    onChange,
}: {
    spaceName: string;
    botOwnerType: "Personal" | "Shared";
    onChange: (value: "Personal" | "Shared") => void;
}) {
    return (
        <Box as="fieldset" border="none">
            <Box
                as="legend"
                className={sprinkles({
                    // `display: block; width: fit-content` is important here! As `inline-block`
                    // there's some weird additional vertical space underneath the label.
                    display: "block",
                    width: "fit-content",
                    maxWidth: "full",
                    fontSize: "75",
                    fontStyle: "truncate-semi-bold",
                    paddingBottom: "3",
                })}
            >
                Who can use and manage this bot?
            </Box>
            <Box display="flex" flexDirection="column" gap="3">
                <OauthDeviceBotOwnerRadio
                    value="Personal"
                    selectedValue={botOwnerType}
                    onChange={onChange}
                    title="Private to me"
                    subtitle="Only you can use and manage it"
                />
                <OauthDeviceBotOwnerRadio
                    value="Shared"
                    selectedValue={botOwnerType}
                    onChange={onChange}
                    title={`Shared with ${spaceName}`}
                    subtitle="Anyone in your space can use it and all space admins can manage it"
                />
            </Box>
        </Box>
    );
}

function OauthDeviceBotOwnerRadio({
    value,
    selectedValue,
    onChange,
    title,
    subtitle,
}: {
    value: "Personal" | "Shared";
    selectedValue: "Personal" | "Shared";
    onChange: (value: "Personal" | "Shared") => void;
    title: string;
    subtitle: string;
}) {
    return (
        <Box
            as="label"
            display="flex"
            alignItems="flex-start"
            gap="3"
            cursor="pointer"
            userSelect="none"
        >
            <input
                type="radio"
                name="botOwnerType"
                value={value}
                checked={selectedValue === value}
                onChange={() => onChange(value)}
                className={sprinkles({
                    width: "5",
                    height: "5",
                    flexShrink: "0",
                    cursor: "pointer",
                })}
                style={{accentColor: colorSchemeVars["theme-40-const"]}}
            />
            <Box display="flex" flexDirection="column">
                <Box fontSize="75" fontStyle="semi-bold" color="grey-90">
                    {title}
                </Box>
                <Box fontSize="75" color="grey-60">
                    {subtitle}
                </Box>
            </Box>
        </Box>
    );
}
