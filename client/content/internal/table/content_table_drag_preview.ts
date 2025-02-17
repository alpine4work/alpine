import {dotsSixIconSvg} from "~/client/icons/dots_six_icon_svg.js";
import {dotsSixVerticalIconSvg} from "~/client/icons/dots_six_vertical_icon_svg.js";
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
    element.className =
        options.type === "column"
            ? contentStyles.contentTableColumnDragPreviewClassName
            : contentStyles.contentTableRowDragPreviewClassName;
    element.style.width = `${options.width}px`;
    element.style.height = `${options.height}px`;

    const iconDiv = document.createElement("div");
    iconDiv.className =
        options.type === "column"
            ? contentStyles.contentTableColumnDragPreviewIconClassName
            : contentStyles.contentTableRowDragPreviewIconClassName;
    iconDiv.innerHTML = options.type === "column" ? dotsSixIconSvg() : dotsSixVerticalIconSvg();
    element.appendChild(iconDiv);

    let rafId: number;
    function updatePosition(x: number, y: number) {
        if (options.type === "column") {
            // For columns, center horizontally on cursor and align to top
            element.style.transform = `translate(${x}px, ${y - 2}px) translate(-50%, 0)`;
        } else {
            // For rows, center vertically on cursor and align to left
            element.style.transform = `translate(${x}px, ${y}px) translate(-16px, -50%)`;
        }
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
