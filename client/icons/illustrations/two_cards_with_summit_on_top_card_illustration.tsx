export function TwoCardsWithSummitOnTopCardIllustration({strokeWidth = 1}: {strokeWidth?: number}) {
    const style = `.st0,.st1,.st2{fill:none;stroke:currentcolor;stroke-width:${strokeWidth}}.st0{stroke-miterlimit:10}.st1,.st2{stroke-linecap:round}.st1{stroke-linejoin:round}.st2{stroke-miterlimit:10}`;

    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500">
            <defs>
                <style>{style}</style>
            </defs>
            <path
                d="m253.7 113 102.5 241.6c4.4 10.4-.4 22.5-10.9 26.9l-160.8 68.2c-10.4 4.4-22.5-.4-26.9-10.9L55.3 197.1c-4.4-10.4.4-22.5 10.9-26.9l160.7-68.1c10.4-4.4 22.4.5 26.8 10.9z"
                className="st0"
            />
            <path
                d="m257.5 122 122.7.1c11.6 0 21.1 9.5 21.1 21.2l-.2 262.2c0 11.6-9.5 21.1-21.2 21.1l-141.1-.1"
                className="st0"
            />
            <path d="M315.4 258.4H366m-23 65.2h23" className="st1" />
            <path
                d="M150.9 391.3c.7-5.4 9.5-64.3 61.4-87.2 53.2-23.4 103.4 12.2 107.4 15.2"
                className="st0"
            />
            <path
                d="m170.6 211.8 39.7 93.1m-28.2-66.2c2.9-5.2 6.3-7.7 8.9-9.1 8.6-4.5 16.2 0 28.7-4.4 3-1 5.8-2.4 8.5-4.1m-57.6-9.3c2.4-2 6.2-4.7 11.3-6.1 7.9-2.2 12 .5 18.4-1.5 3.5-1.1 8.2-3.8 12.8-10.9"
                className="st2"
            />
            <path
                d="M213.1 193.3c2.8 1.9 7 5.1 10.3 10.4 4.4 7 4.9 13.8 4.9 17.4m98.4-166v20.8M309 80h13.1m8.4 0h13.1m-16.9 4.2V105M98.9 372.2V393m-17.7 4.1h13.1m8.4 0h13.1m-16.9 4.2v20.8m339.4-164.6v20.8m-17.7 4.1h13m8.5 0h13m-16.8 4.2v20.8"
                className="st2"
            />
            <path d="M290.9 200.6H366" className="st1" />
        </svg>
    );
}
