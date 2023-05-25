import {Fire, FireSimple, Lightning, PersonSimpleRun} from "phosphor-react";
import {useState} from "react";
import {Box} from "~/client/design/box";
import {Button} from "~/client/design/button";
import {addRemLengths, spacing} from "~/shared/design/spacing";
import {colorSchemeVars, contentSchemaStyles, sprinkles} from "~/shared/styles/styles";

export type TaskAssigneeStatus = "Inactive" | "Active";

export function TaskDetailAssigneeStatusButton() {
    const [assigneeStatus, setAssigneeStatus] = useState("Inactive");

    return (
        <Box
            position="relative"
            zIndex="0"
            display="flex"
            alignItems="center"
            gap="0.5"
            paddingLeft="1"
            paddingRight="1.5"
            paddingY="0.5"
        >
            <Box position="relative" zIndex="0">
                <Fire
                    color={colorSchemeVars["theme-50-const"]}
                    size={addRemLengths(spacing["3"], spacing["0.5"])}
                    weight="fill"
                />
                <FireSimple
                    size={addRemLengths(spacing["3"], spacing["0.5"])}
                    weight="fill"
                    className={sprinkles({
                        position: "absolute",
                        zIndex: "-10",
                        top: "0",
                        left: "0",
                        color: "grey-0-const",
                    })}
                    style={{transform: "scale(0.8)"}}
                />
            </Box>
            <Box fontStyle="semi-bold">Active</Box>
            {/* <Box
                position="absolute"
                zIndex="-10"
                pointerEvents="none"
                inset="0"
                borderRadius="full"
                backgroundColor="theme-10"
                style={{opacity: contentSchemaStyles.currentAccountMentionBackgroundOpacity}}
            /> */}
        </Box>
    );

    return (
        <Button
            variant="quiet-off"
            height="6"
            paddingX="2"
            icon={<FireSimple size={spacing["4"]} />}
        >
            Inactive
        </Button>
    );
}
