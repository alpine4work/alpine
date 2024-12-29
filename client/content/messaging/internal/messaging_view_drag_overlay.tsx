import {useEffect, useState} from "react";
import {TwoCardsWithSummitOnTopCardIllustration} from "~/client/icons/illustrations/two_cards_with_summit_on_top_card_illustration.js";
import {sprinkles} from "~/client/styles/styles.js";

export function MessagingViewDragOverlay() {
    const [isInitialRender, setIsInitialRender] = useState(true);

    useEffect(() => {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                setIsInitialRender(false);
            });
        });
    }, []);

    return (
        <div
            data-testid="MessagingViewDragOverlay"
            className={sprinkles({
                zIndex: "60",
                position: "absolute",
                inset: "0",
                width: "full",
                height: "full",
                backgroundColor: "grey-0-opacity-90",
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                alignItems: "center",
                opacity: isInitialRender ? "0" : "100",
            })}
            style={{transition: "opacity 200ms ease-out"}}
        >
            <div
                className={sprinkles({width: "64", color: "grey-90"})}
                style={{
                    transform: isInitialRender ? "rotate(4deg) translateX(0.5rem)" : undefined,
                    transformOrigin: "bottom right",
                    transition: "transform 200ms ease-out",
                }}
            >
                <TwoCardsWithSummitOnTopCardIllustration strokeWidth={3} />
            </div>
            <div
                className={sprinkles({
                    fontSize: "400",
                    fontStyle: "light",
                    paddingBottom: "16",
                })}
            >
                Drop files to share
            </div>
        </div>
    );
}
