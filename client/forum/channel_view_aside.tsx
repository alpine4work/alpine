import {useNavigate} from "react-router-dom";
import {ContentView} from "~/client/content/content_view";
import {Box} from "~/client/design/box";
import {postListViewMargin} from "~/client/forum/post_list_view";
import {ChannelModel} from "~/shared/models/channel_model";
import {sprinkles} from "~/shared/styles/styles";

export function ChannelViewAside({channel}: {channel: ChannelModel}) {
    return (
        <aside className={sprinkles({paddingTop: postListViewMargin})}>
            <Box
                backgroundColor="grey-0"
                borderRadius="md"
                boxShadow="elevation-5"
                paddingX="1.5"
                paddingY="3"
            >
                <h3
                    className={sprinkles({
                        paddingLeft: "2",
                        paddingBottom: "1",
                        color: "grey-50",
                    })}
                >
                    About
                </h3>
                <ContentView content={channel.description} onNavigate={useNavigate()} />
            </Box>
        </aside>
    );
}
