import {useEffect, useRef, useState} from "react";
import {createPortal} from "react-dom";
import {dotsSixIconSvg} from "~/client/icons/dots_six_icon_svg.js";
import {contentStyles} from "~/client/styles/styles.js";

interface DragPreviewProps {
    width: number;
    height: number;
    initialX: number;
    initialY: number;
    type: "column" | "row";
    onMove?: (x: number, y: number) => void;
}

export function ContentTableDragPreview({
    width,
    height,
    initialX,
    initialY,
    type,
    onMove,
}: DragPreviewProps) {
    const [position, setPosition] = useState({x: initialX, y: initialY});
    const rafRef = useRef<number>();

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (rafRef.current) {
                cancelAnimationFrame(rafRef.current);
            }

            rafRef.current = requestAnimationFrame(() => {
                const newX = e.clientX;
                const newY = e.clientY;
                setPosition({x: newX, y: newY});
                onMove?.(newX, newY);
            });
        };

        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("pointermove", handleMouseMove);

        return () => {
            document.removeEventListener("mousemove", handleMouseMove);
            document.removeEventListener("pointermove", handleMouseMove);
            if (rafRef.current) {
                cancelAnimationFrame(rafRef.current);
            }
        };
    }, [onMove]);

    return createPortal(
        <div
            className={contentStyles.contentTableColumnDragPreviewClassName}
            style={{
                width: `${width}px`,
                height: `${height}px`,
                transform: `translate(${position.x - width / 2}px, ${position.y}px)`,
            }}
        >
            <div
                className={contentStyles.contentTableColumnDragPreviewIconClassName}
                dangerouslySetInnerHTML={{__html: dotsSixIconSvg()}}
            />
        </div>,
        document.body,
    );
}
