import {useState} from "react";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {TextInput} from "~/client/web/design/text_input.js";
import {SpaceRouteScrollView} from "~/client/web/navigation/space_route_scroll_view.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useRootNavigate} from "~/client/web/remix/use_navigate.js";
import {metaTitlePostfix} from "~/client/web/remix/use_update_meta_title.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {screenPaddingX} from "~/shared/design/core/spacing.js";
import {createSpace} from "~/shared/rpc/spaces_rpc_definitions.js";

export function meta() {
    return [{title: `Create space${metaTitlePostfix}`}];
}

export async function loader({context: unauthenticatedContext}: LoaderArgs) {
    (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();
    return null;
}

export default function CreateSpaceRoute() {
    const platform = usePlatform();
    const appContext = useAppContext();
    const rootNavigate = useRootNavigate();
    const [name, setName] = useState("");

    const maxWidth = platform !== "mobile" ? "96" : undefined;

    return (
        <SpaceRouteScrollView
            title="Create space"
            titleJustifyContent="center"
            desktopMaxWidth={maxWidth}
            withoutDisappearingTitle
        >
            <Box
                width="full"
                maxWidth={maxWidth}
                paddingX={screenPaddingX}
                paddingY="4"
                marginX="center"
                display="flex"
                flexDirection="column"
                gap="3"
            >
                <TextInput placeholder="My Company" label="Name" onChange={setName} value={name} />
                <Button
                    fullWidth
                    height="8"
                    isDisabled={name.trim().length === 0}
                    variant="accent"
                    pressErrorTitle="Couldn\u2019t create a space"
                    onPress={async () => {
                        const {space} = await createSpace(appContext, {
                            name,
                        });

                        await rootNavigate(`/s/${space.id}`);
                    }}
                >
                    Create
                </Button>
            </Box>
        </SpaceRouteScrollView>
    );
}
