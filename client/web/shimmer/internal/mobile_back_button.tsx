import {ArrowLeft} from "phosphor-react";
import {IconButton} from "~/client/web/design/icon_button.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";

export function MobileBackButton() {
    const navigate = useNavigate();

    return (
        <IconButton
            size="base"
            description="Go back"
            withoutTooltip={true}
            pressErrorTitle="Couldn\u2019t go back"
            onPress={() => navigate(-1)}
        >
            <ArrowLeft />
        </IconButton>
    );
}

export function MobileBackButtonSpacer() {
    return <Spacer space="7" />;
}
