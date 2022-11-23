import Color from "color";
import {useRef} from "react";
import {BlobFactorySettings} from "~/client/blob_factory/blob_factory_types";
import {BlobFactory, drawBlobFactory} from "~/client/blob_factory/internal/draw_blob_factory";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {useResizeObserver} from "~/client/helpers/use_resize_observer";
import {colors} from "~/shared/design/colors";
import {formatCssLinearGradient, generateEasedGradient} from "~/shared/design/gradient";
import {assert} from "~/shared/helpers/control/assert";
import {easeInOutSin} from "~/shared/helpers/easing";
import {Vector2} from "~/shared/helpers/geometry/vector2";
import {sprinkles} from "~/shared/styles/styles";

export function BlobFactory({
    width,
    height,
    fadeToBlank = false,
    settings,
}: {
    width?: number;
    height?: number;
    fadeToBlank?: boolean;
    settings: BlobFactorySettings;
}) {
    const containerRef = useRef<HTMLDivElement>(null);
    const containerRect = useResizeObserver(containerRef);
    const hasContainerRect = !!containerRect;
    const displayCanvasRef = useRef<HTMLCanvasElement>(null);
    const blobFactoryRef = useRef<BlobFactory | null>(null);

    // We accept that while server-side rendering we can't show blobs.
    // I wonder if there is anyway to run blob factory server side...
    useLayoutEffectWithoutServerSideWarning(() => {
        if (!hasContainerRect) return;

        assert(displayCanvasRef.current);
        blobFactoryRef.current = drawBlobFactory(displayCanvasRef.current);

        return () => {
            assert(blobFactoryRef.current);
            blobFactoryRef.current.destroy();
            blobFactoryRef.current = null;
        };
    }, [hasContainerRect]);

    // We accept that while server-side rendering we can't show blobs
    // I wonder if there is anyway to run blob factory server side....
    useLayoutEffectWithoutServerSideWarning(() => {
        if (!containerRect) return;

        assert(blobFactoryRef.current);
        blobFactoryRef.current.setSize(new Vector2(containerRect.width, containerRect.height));
    }, [containerRect]);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (!containerRect) return;

        assert(blobFactoryRef.current);
        blobFactoryRef.current.setSettings(settings);
    }, [settings, containerRect]);

    return (
        <div
            ref={containerRef}
            className={sprinkles({
                zIndex: "-50",
                position: "absolute",
                inset: "0",
                width: width ? undefined : "full",
                height: height ? undefined : "full",
            })}
            aria-hidden="true"
            style={{width, height}}
        >
            {containerRect && (
                <canvas
                    ref={displayCanvasRef}
                    width={containerRect.width * window.devicePixelRatio}
                    height={containerRect.height * window.devicePixelRatio}
                    className={sprinkles({
                        position: "absolute",
                        inset: "0",
                        width: "full",
                        height: "full",
                    })}
                />
            )}
            {fadeToBlank && (
                <div
                    className={sprinkles({
                        position: "absolute",
                        inset: "0",
                    })}
                    style={{
                        backgroundImage: formatCssLinearGradient(
                            "to bottom",
                            generateEasedGradient(
                                new Color(colors[settings.backgroundColor]).alpha(0).toString(),
                                colors[settings.backgroundColor],
                                easeInOutSin,
                                10,
                            ),
                        ),
                    }}
                />
            )}
        </div>
    );
}
