import {CaretDown} from "phosphor-react";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {MenuButton} from "~/client/web/design/menu_button.js";
import {PrettyNumber} from "~/client/web/design/pretty_number.js";
import {LockBoldFillIcon} from "~/client/web/icons/lock_bold_fill_icon.js";
import {
    TeamspaceImportOptionType,
    TeamspaceImportOptionsMap,
} from "~/client/web/importers/notion/notion_import_types.js";
import {contentStyles} from "~/client/web/styles/styles.js";
import {spacing} from "~/shared/design/core/spacing.js";

const importOptionDisplay: {[K in TeamspaceImportOptionType]: string} = {
    Public: "Public",
    Private: "Private",
    DoNotImport: "Don\u2019t import",
};

export function NotionImportTeamspaceOptions({
    workspaceName,
    teamspaces,
    options,
    onChange,
}: {
    workspaceName: string;
    teamspaces: Array<{id: string; name: string}>;
    options: TeamspaceImportOptionsMap | null;
    onChange: (options: TeamspaceImportOptionsMap) => void;
}) {
    const teamspacesList = (
        <Box display="flex" flexDirection="column" gap="3">
            {teamspaces.map(ts => {
                const choice = options?.get(ts.id);
                return (
                    <Box
                        key={ts.id}
                        display="flex"
                        alignItems="center"
                        justifyContent="space-between"
                        maxWidth="full"
                        padding="3"
                        paddingLeft="4"
                        borderRadius="1"
                        boxShadow="elevation-5-with-grey-10-border"
                    >
                        <Box
                            display="flex"
                            alignItems="center"
                            gap="2"
                            flex="1"
                            overflow="hidden"
                            style={{minWidth: 0}}
                        >
                            <Box
                                fontSize="100"
                                fontStyle="truncate"
                                color={choice?.type === "DoNotImport" ? "grey-50" : undefined}
                                userSelect="text"
                            >
                                {ts.name}
                            </Box>
                        </Box>
                        <MenuButton
                            placement="bottom-end"
                            actions={[
                                [
                                    {
                                        label: "Public",
                                        isSelected: choice?.type === "Public",
                                        onPress: () => {
                                            onChange(new Map(options).set(ts.id, {type: "Public"}));
                                        },
                                    },
                                    {
                                        label: "Private",
                                        isSelected: choice?.type === "Private",
                                        onPress: () => {
                                            onChange(
                                                new Map(options).set(ts.id, {type: "Private"}),
                                            );
                                        },
                                    },
                                ],
                                ...(teamspaces.length > 1
                                    ? [
                                          [
                                              {
                                                  label: "Don\u2019t import",
                                                  isSelected: choice?.type === "DoNotImport",
                                                  onPress: () => {
                                                      onChange(
                                                          new Map(options).set(ts.id, {
                                                              type: "DoNotImport" as const,
                                                          }),
                                                      );
                                                  },
                                              },
                                          ],
                                      ]
                                    : []),
                            ]}
                        >
                            <Button
                                paddingX="2"
                                variant="quiet"
                                icon={<CaretDown />}
                                iconPlacement="start"
                            >
                                <Box display="flex" alignItems="center" gap="1">
                                    {choice?.type === "Private" && (
                                        <LockBoldFillIcon size={spacing["3"]} />
                                    )}
                                    {importOptionDisplay[choice?.type ?? "Public"]}
                                </Box>
                            </Button>
                        </MenuButton>
                    </Box>
                );
            })}
        </Box>
    );

    return (
        <Box display="flex" flexDirection="column" gap={contentStyles.standaloneBlockMargin}>
            <Box
                fontSize="100"
                color="grey-80"
                userSelect="text"
                style={{lineHeight: contentStyles.paragraphLineHeightVar}}
            >
                There {teamspaces.length === 1 ? "is" : "are"}{" "}
                <PrettyNumber number={teamspaces.length} label="teamspace" smallNumbersAsWords /> in{" "}
                <Box fontStyle="bold" color="grey-100" display="inline">
                    {workspaceName}
                </Box>
                . Choose how {teamspaces.length === 1 ? "it" : "they"} should be imported into
                Alpine.
            </Box>
            {teamspacesList}
        </Box>
    );
}
