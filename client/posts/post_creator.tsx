import {useState} from "react";
import {useNavigate} from "react-router-dom";
import {ContentEditor} from "~/client/content/content_editor";
import {ContentEditorState} from "~/client/content/content_editor_state";
import {Box} from "~/client/design/box";
import {Button} from "~/client/design/button";
import {emptyPostContent} from "~/shared/posts/post_content_schema";
import {sprinkles, truncateClassName} from "~/shared/styles/styles";

export function PostCreator() {
    const [state, setState] = useState(() => ContentEditorState.create(emptyPostContent));

    return (
        <Box>
            <Box
                backgroundColor={{light: "grey-0", dark: "grey-5"}}
                borderRadius="md"
                boxShadow="elevation-5"
            >
                <Box paddingTop="4" paddingX="4" display="flex">
                    <Box
                        flexShrink="0"
                        width="8"
                        height="8"
                        backgroundColor="grey-30-const"
                        borderRadius="full"
                    />
                    <Box flexGrow="1" paddingLeft="3" paddingRight="4" overflow="hidden">
                        <Box fontStyle="semi-bold" className={truncateClassName}>
                            Caleb Meredith
                        </Box>
                        <Box color="grey-50" className={truncateClassName}>
                            New post
                        </Box>
                    </Box>
                </Box>
                <ContentEditor
                    aria-label="New post content"
                    state={state}
                    onChange={setState}
                    onNavigate={useNavigate()}
                    placeholder="Share your ideas…"
                    className={sprinkles({paddingTop: "4", paddingBottom: "4"})}
                />
                <Box paddingX="4" paddingBottom="4">
                    <Box borderTop={{light: "grey-5", dark: "grey-10"}} />
                    <Box paddingTop="4" display="flex" justifyContent="flex-end">
                        <Button variant="accent" isDisabled={true}>
                            Create
                        </Button>
                    </Box>
                </Box>
            </Box>
        </Box>
    );
}
