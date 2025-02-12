import {dotsSixIconSvg} from "~/client/icons/dots_six_icon_svg.js";
import {contentStyles} from "~/client/styles/styles.js";

interface DragPreviewOptions {
    width: number;
    height: number;
    initialX: number;
    initialY: number;
    type: "column" | "row";
    onMove?: (x: number, y: number) => void;
}

export function createDragPreview(options: DragPreviewOptions) {
    const element = document.createElement("div");
    element.className = contentStyles.contentTableColumnDragPreviewClassName;
    element.style.width = `${options.width}px`;
    element.style.height = `${options.height}px`;

    const iconDiv = document.createElement("div");
    iconDiv.className = contentStyles.contentTableColumnDragPreviewIconClassName;
    iconDiv.innerHTML = dotsSixIconSvg();
    element.appendChild(iconDiv);

    let rafId: number;

    function updatePosition(x: number, y: number) {
        element.style.transform = `translate(${x - element.offsetWidth / 2}px, ${y - 2}px)`;
    }

    function handleMouseMove(e: MouseEvent) {
        if (rafId) {
            cancelAnimationFrame(rafId);
        }

        rafId = requestAnimationFrame(() => {
            const newX = e.clientX;
            const newY = e.clientY;
            updatePosition(newX, newY);
            options.onMove?.(newX, newY);
        });
    }

    updatePosition(options.initialX, options.initialY);
    document.body.appendChild(element);

    document.addEventListener("pointermove", handleMouseMove);

    return {
        destroy() {
            document.removeEventListener("pointermove", handleMouseMove);
            if (rafId) {
                cancelAnimationFrame(rafId);
            }
            element.remove();
        },
    };
}
