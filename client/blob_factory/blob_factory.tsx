import {useRef} from "react";
import {BlobFactory, drawBlobFactory} from "~/client/blob_factory/internal/draw_blob_factory";
import {useColorScheme} from "~/client/design/color_scheme";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {useResizeObserver} from "~/client/helpers/use_resize_observer";
import {assert} from "~/shared/helpers/control/assert";
import {Vector2} from "~/shared/helpers/geometry/vector2";
import {sprinkles} from "~/shared/styles/styles";

export function BlobFactory() {
    const colorScheme = useColorScheme();

    const containerRef = useRef<HTMLDivElement>(null);
    const containerRect = useResizeObserver(containerRef);
    const hasContainerRect = !!containerRect;
    const displayCanvasRef = useRef<HTMLCanvasElement>(null);
    const blobFactoryRef = useRef<BlobFactory | null>(null);

    // We accept that while server-side rendering we can't show blobs.
    // I wonder if there is anyway to run blob factory server side...
    useLayoutEffectWithoutServerSideWarning(() => {
        if (!hasContainerRect || !colorScheme) return;

        assert(displayCanvasRef.current);
        blobFactoryRef.current = drawBlobFactory(displayCanvasRef.current, {colorScheme});

        return () => {
            assert(blobFactoryRef.current);
            blobFactoryRef.current.destroy();
            blobFactoryRef.current = null;
        };
    }, [colorScheme, hasContainerRect]);

    // We accept that while server-side rendering we can't show blobs
    // I wonder if there is anyway to run blob factory server side....
    useLayoutEffectWithoutServerSideWarning(() => {
        if (!containerRect || !colorScheme) return;

        assert(blobFactoryRef.current);
        blobFactoryRef.current.setSize(new Vector2(containerRect.width, containerRect.height));
    }, [colorScheme, containerRect]);

    return (
        <div
            ref={containerRef}
            className={sprinkles({
                position: "absolute",
                inset: "0",
                width: "full",
                height: "full",
                zIndex: "-50",
            })}
            aria-hidden="true"
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
        </div>
    );
}
