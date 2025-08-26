import { useState, useEffect, useRef } from "react";

export default function ScrapedGallery() {
    const [url, setUrl] = useState("");
    const [brandFilter, setBrandFilter] = useState("");
    const [productsFilter, setProductsFilter] = useState("");
    const [pageLimit, setPageLimit] = useState(1);
    const [stats, setStats] = useState({ pages: 0, total: 0, matched: 0});
    const [summary, setSummary] = useState({ pages: 0, total: 0, matched: 0, unused_brands: [], unused_products: []});
    const [scraped, setScraped] = useState(() => {
        const saved = localStorage.getItem("scrapedData");
        return saved ? JSON.parse(saved) : [];
    });
    const [progress, setProgress] = useState(0);
    const [loading, setLoading] = useState(false);

    console.log(scraped)

    useEffect(() => {
        localStorage.setItem("scrapedData", JSON.stringify(scraped));
    }, [scraped]);

    const playSound = () => {
        const audio = new Audio('/done.mp3');
        audio.play();
    };

    const handleScrape = async () => {
        setScraped([]);
        setProgress(0);
        setStats({ pages: 0, total: 0, matched: 0 });
        setLoading(true);

        try {
        const res = await fetch(
            `http://localhost:5000/scrape-products?base_url=${encodeURIComponent(
                url
            )}&page_limit=${pageLimit}&brands=${encodeURIComponent(
                brandFilter
            )}&products=${encodeURIComponent(productsFilter)}`
        );

        if (!res.ok) throw new Error("❌ Error fetching stream");

        const reader = res.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split("\n\n");
            buffer = parts.pop(); // save incomplete part for next loop

            for (let part of parts) {
            if (!part.startsWith("data: ")) continue;
            const jsonStr = part.replace("data: ", "");

            try {
                const payload = JSON.parse(jsonStr);

                if (payload.status === "scraping_page") {
                setStats((prev) => ({ ...prev, pages: payload.page }));
                } else if (payload.product) {
                setScraped((prev) => [...prev, payload.product]);
                setProgress((prev) => prev + 1);
                setStats((prev) => ({
                    ...prev,
                    total: payload.stats.total,
                    matched: payload.stats.matched,
                }));
                } else if (payload.summary) {
                    setStats({
                    pages: payload.summary.total_pages,
                    total: payload.summary.total_links,
                    matched: payload.summary.matched,
                    });

                    setSummary({
                    pages: payload.summary.total_pages,
                    total: payload.summary.total_links,
                    matched: payload.summary.matched,
                    unused_brands: payload.summary.unused_brands || [],
                    unused_products: payload.summary.unused_products || [],
                    });
                    console.log("📦 Summary payload:", payload.summary);
                }
            } catch (e) {
                console.error("❌ Parse error:", e);
            }
            }
        }
        } catch (e) {
        console.error(e);
        } finally {
        playSound()
        setLoading(false);
        }
    };

    return (
        <>
        <div className="flex">
            <div className="w-full max-w-220 py-2 px-8 flex flex-col gap-4">
                <Form
                    url={url}
                    setUrl={setUrl}
                    pageLimit={pageLimit}
                    setPageLimit={setPageLimit}
                    brandFilter={brandFilter}
                    setBrandFilter={setBrandFilter}
                    productsFilter={productsFilter}
                    setProductsFilter={setProductsFilter}
                    handleScrape={handleScrape}
                />
                <Gallery
                    scraped={scraped}
                    loading={loading}
                    progress={progress}
                    stats={stats}
                    summary = {summary}
                />
            </div>
            <ImageExport 
                handleSound = {playSound}
                scraped={scraped}
            />
        </div>
        </>
    );
}

const Form = ({
    url,
    setUrl,
    pageLimit,
    setPageLimit,
    brandFilter,
    setBrandFilter,
    productsFilter,
    setProductsFilter,
    handleScrape,
}) => {
    return (
        <div className="w-full justify-between flex flex-wrap gap-4">
        <div className="w-full">
            <label className="block text-white font-semibold">URL</label>
            <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="bg-white text-black w-full px-2"
            />

            <label className="block text-white font-semibold mt-2">Page Limit</label>
            <input
            type="number"
            min={1}
            value={pageLimit}
            onChange={(e) => setPageLimit(Number(e.target.value))}
            className="bg-white text-black w-full px-2"
            />

            <label className="block text-white font-semibold mt-2">Filter by Title (Brand)</label>
            <input
            type="text"
            value={brandFilter}
            onChange={(e) => setBrandFilter(e.target.value)}
            className="bg-white text-black w-full px-2"
            placeholder="e.g. benq, acer"
            />

            <label className="block text-white font-semibold mt-2">Filter by Title (Products)</label>
            <textarea
            value={productsFilter}
            onChange={(e) => setProductsFilter(e.target.value)}
            className="bg-white text-black w-full h-25 px-2"
            placeholder="e.g. monitor, keyboard"
            />
        </div>

        <button
            type="button"
            onClick={handleScrape}
            className="bg-amber-800 w-full max-w-50 py-3 font-semibold text-lg"
        >
            New Scrape
        </button>
        </div>
    );
};

const Gallery = ({ scraped, loading, progress, stats, summary }) => {
    return (
        <div>
        {loading && (
            <div className="text-white text-sm mb-2">
            <p>
                Scraping... {progress} product{progress !== 1 ? "s" : ""} loaded.
            </p>
            <p>
                📄 Pages: {stats.pages} | 📦 Scanned: {stats.total} | ✅ Matched:{" "}
                {stats.matched}
            </p>
            </div>
        )}
        {summary.unused_brands?.length > 0 || summary.unused_products?.length > 0 ? (
        <div className="bg-yellow-100 p-2 rounded text-black mb-2 text-sm">
            <p className="font-bold">❌ Unused Keywords:</p>
            {summary.unused_brands?.length > 0 && (
            <p>Brands not found: {summary.unused_brands.join(", ")}</p>
            )}
            {summary.unused_products?.length > 0 && (
                <div>
                    <p>Products not found:</p>
                    <ul>
                    {summary.unused_products.map((product, index) => (
                        <li key={index}>{product}</li>
                    ))}
                    </ul>
                </div>
            )}
        </div>
        ) : null}
        <div className="bg-gray-900 w-full h-200 overflow-auto flex flex-wrap justify-center items-start border gap-4 p-4">
            {scraped.map((product, index) => (
            <ImageCard key={index} title={product.title} images={product.images} />
            ))}
        </div>
        </div>
        
    );
};

const ImageCard = ({ title, images }) => {
    return (
        <div className="w-60 relative flex flex-col items-center">
        <div className="w-50 h-50 flex bg-black overflow-hidden items-center">
            <img
            className="object-cover"
            src={`http://localhost:5000/proxy-image?url=${encodeURIComponent(
                images[0]
            )}`}
            alt={title}
            />
        </div>
        <p className="text-white text-center text-sm py-1">{title}</p>
        </div>
    );
};


import JSZip from "jszip";
import { saveAs } from "file-saver";

const ImageExport = ({ scraped, handleSound}) => {
    const divRef = useRef();
    const [logo, setLogo] = useState("../src/assets/logo.png");
    const [position, setPosition] = useState("bottom-4 right-4");
    const [isCapturing, setIsCapturing] = useState(false);
    const [progress, setProgress] = useState(0);
    const [preview, setPreview] = useState(null);

    const positions = [
        { value: "top-4 left-4", class: "-top-4 -left-4" },
        { value: "top-4 left-1/2 -translate-x-1/2", class: "-top-4 left-1/2 -translate-x-1/2" },
        { value: "top-4 right-4", class: "-top-4 -right-4" },
        { value: "-translate-y-1/2 top-1/2 left-4", class: "-translate-y-1/2 top-1/2 -left-4" },
        { value: "-translate-y-1/2 top-1/2 left-1/2 -translate-x-1/2", class: "-translate-y-1/2 top-1/2 left-1/2 -translate-x-1/2" },
        { value: "-translate-y-1/2 top-1/2 right-4", class: "-translate-y-1/2 top-1/2 -right-4" },
        { value: "bottom-4 left-4", class: "-bottom-4 -left-4" },
        { value: "bottom-4 left-1/2 -translate-x-1/2", class: "-bottom-4 left-1/2 -translate-x-1/2" },
        { value: "bottom-4 right-4", class: "-bottom-4 -right-4" },
    ];

    let globalImageCounter = 1;

const imageList = scraped.flatMap(product => {
    const brand = (product.brand || "unknownbrand")
        .replace(/[\/\\:*?"<>|]/g, '')
        .replace(/\s+/g, '_')
        .toLowerCase()
        .trim();

    return product.images.map((image) => {
        const name = `${brand}_${globalImageCounter++}`;
        return { image, name };
    });
});


    const zipBlobRef = useRef(null);
    
    useEffect(() => {
        zipBlobRef.current = null; // Reset zip if new scraped data comes in
    }, [scraped]);

    const handleScreenshotAll = async () => {
        if (zipBlobRef.current) {
            saveAs(zipBlobRef.current, "screenshots.zip");
            return;
        }

        setIsCapturing(true);
        setProgress(0);
        const zip = new JSZip();

        // Preload logo once
        const logoImg = new Image();
        logoImg.crossOrigin = "anonymous";
        logoImg.src = logo;
        await new Promise(res => {
            logoImg.onload = res;
            logoImg.onerror = res;
        });

        // Process all images concurrently
        const tasks = imageList.map(({ image, name }, i) => (async () => {
            const imageUrl = `http://localhost:5000/proxy-image?url=${encodeURIComponent(image)}`;
            const canvasSize = 600;
            const padding = 20;
            const whiteBoxSize = canvasSize - padding * 2;
            const border = padding;

            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");
            canvas.width = canvasSize;
            canvas.height = canvasSize;

            // Background gradient
            const gradient = ctx.createLinearGradient(0, 0, canvasSize, 0);
            gradient.addColorStop(0, "#215DA8");
            gradient.addColorStop(0.5, "#36BCE1");
            gradient.addColorStop(1, "#B8FDFB");
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, canvasSize, canvasSize);

            // White box
            ctx.fillStyle = "white";
            ctx.fillRect(border, border, whiteBoxSize, whiteBoxSize);

            // Main image
            const mainImg = new Image();
            mainImg.crossOrigin = "anonymous";
            mainImg.src = imageUrl;
            await new Promise(res => {
                mainImg.onload = res;
                mainImg.onerror = res;
            });

            const imagePadding = 8;
            const scale = Math.min(
                (whiteBoxSize - imagePadding * 2) / mainImg.width,
                (whiteBoxSize - imagePadding * 2) / mainImg.height
            );
            const imgW = mainImg.width * scale;
            const imgH = mainImg.height * scale;
            const x = (canvasSize - imgW) / 2;
            const y = (canvasSize - imgH) / 2;
            ctx.drawImage(mainImg, x, y, imgW, imgH);

            // Logo
            if (logo) {
                const logoSize = 120;
                let logoX = 18, logoY = 18;
                if (position.includes("right")) logoX = canvasSize - logoSize - 18;
                if (position.includes("bottom")) logoY = canvasSize - logoSize - 18;
                if (position.includes("left-1/2")) logoX = (canvasSize - logoSize) / 2;
                if (position.includes("top-1/2")) logoY = (canvasSize - logoSize) / 2;

                ctx.shadowColor = "rgba(0,0,0,0.6)";
                ctx.shadowOffsetY = "3";
                ctx.shadowBlur = 4;
                ctx.drawImage(logoImg, logoX, logoY, logoSize, logoSize);
                ctx.shadowColor = "transparent";
            }

            const blob = await new Promise(res => canvas.toBlob(res, "image/png"));
            zip.file(`${name}.png`, blob);

            // Optional: show preview only for first image
            if (i === 0) setPreview(canvas.toDataURL("image/png"));
        })());

        // Track progress manually
        let completed = 0;
        for (const task of tasks) {
            await task;
            completed++;
            setProgress(Math.round((completed / imageList.length) * 100));
        }

        if (handleSound) handleSound();

        const content = await zip.generateAsync({ type: "blob" });
        zipBlobRef.current = content;
        saveAs(content, "screenshots.zip");
        setIsCapturing(false);
        setProgress(0);
    };



    return (
        <div className="w-full max-w-220 flex flex-col gap-8 items-center py-2 px-8">
            <div>

                {!preview &&(<div className="relative w-150 h-150 bg-white shadow" ref={divRef}>
                    <div
                        className="h-full w-full absolute inset-0 z-0"
                        style={{ background: "linear-gradient(90deg, #215DA8, #36BCE1, #B8FDFB)" }}
                        />
                    <div className="absolute bg-white w-140 h-140 -translate-x-1/2 -translate-y-1/2 top-1/2 left-1/2 inset-0 z-10"></div>
                    <img
                        className={`w-30 ${position} absolute z-20 drop-shadow-md/60`}
                        src={logo}
                        alt="logo"
                        style={{ pointerEvents: 'none' }}
                        />
                </div>)}
                {preview && (
                    <img src={preview} alt="Preview" className="w-150" />
                )}

            </div>

            <button
                onClick={handleScreenshotAll}
                disabled={isCapturing}
                className="px-6 py-3 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
                {isCapturing ? `Capturing... ${progress}%` : "Screenshot All (ZIP)"}
            </button>

            {isCapturing && (
                <div className="w-full max-w-md bg-gray-300 rounded h-4 overflow-hidden">
                    <div
                        className="h-full bg-green-500 transition-all duration-300"
                        style={{ width: `${progress}%` }}
                    />
                </div>
            )}

            <div className="flex justify-around w-full p-8 bg-gray-900 gap-8">
                <div className="flex w-50 flex-col items-center gap-6">
                    <h1 className="text-center text-4xl text-white">Position</h1>
                    <form className="bg-gray-900 border-gray-600 border-8 w-35 h-35 relative">
                        {positions.map(({ value, class: posClass }, i) => (
                            <label key={i} className={`absolute ${posClass}`}>
                                <input
                                    type="radio"
                                    name="imgPos"
                                    value={value}
                                    className="sr-only peer"
                                    onChange={() => setPosition(value)}
                                    checked={position === value}
                                />
                                <div className="w-10 h-10 bg-gray-900 border-8 border-gray-600 peer-checked:border-gray-400 peer-checked:bg-white transition-all ease-in-out hover:scale-110 hover:border-gray-400" />
                            </label>
                        ))}
                    </form>
                </div>

                <div className="flex w-40 flex-col items-center gap-4 relative group">
                    <h1 className="text-center text-4xl text-white">Logo</h1>
                    <div className="relative">
                        <img src={logo} alt="Logo preview" className="border-1 w-50" />
                        <input
                            type="file"
                            accept="image/*"
                            className="absolute -translate-y-1/2 top-1/2 left-1/2 text-xs -translate-x-1/2 bg-amber-600 py-2 px-6 rounded-full font-bold transition-all opacity-0 group-hover:opacity-100 hover:bg-amber-400"
                            onChange={(e) => {
                                const file = e.target.files[0];
                                if (file) {
                                    const preview = URL.createObjectURL(file);
                                    setLogo(preview);
                                }
                            }}
                        />
                    </div>
                </div>
            </div>
            <ExportCSV 
                scraped={scraped}
            />
        </div>
    );
};

import * as XLSX from "xlsx";


const ExportCSV = ({ scraped }) => {
    const handleExportWooCSV = () => {
        if (!scraped.length) return;

        const headers = [
            "Name",
            "Type",
            "Regular price",
            "Description",
            "Images",
            "Categories",
            "Brands"
        ];

        const fixEncoding = (text = "") => {
            return text
                .replace(/â€“/g, "–")
                .replace(/â€”/g, "—")
                .replace(/â€˜/g, "‘")
                .replace(/â€™/g, "’")
                .replace(/â€œ/g, "“")
                .replace(/â€/g, "”")
                .replace(/â€\s?/g, "\"")
                .replace(/â‰¥/g, "≥")
                .replace(/â‰¤/g, "≤")
                .replace(/Â°/g, "°")
                .replace(/Â±/g, "±")
                .replace(/ï¼‰/g, ")")
                .replace(/ï¼ˆ/gi, "(")
                .replace(/Â/g, "");
        };

        let imageCounter = 1;

        const rows = scraped.map(p => {
            const brand = (p.brand || "unknownbrand")
                .replace(/[\/\\:*?"<>|]/g, '')
                .replace(/\s+/g, '_')
                .toLowerCase()
                .trim();

            const imageLinks = p.images.map(() => {
                const fileName = `${brand}_${imageCounter++}.png`;
                return `https://narptech.ph/wp-content/uploads/2025/07/${fileName}`;
            }).join(',');

            const rawDesc = `"${fixEncoding(p.description || "").replace(/"/g, '""')}"`;

            return [
                `"${p.title}"`,
                `"simple"`,
                `"${p.price?.replace(/[^\d.]/g, '') || ""}"`,
                rawDesc,
                `"${imageLinks}"`,
                `"${(p.category || "").toUpperCase()}"`,
                `"${(p.brand || "").toUpperCase()}"`
            ];
        });


        const csv = [headers, ...rows].map(row => row.join(",")).join("\n");
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);

        const link = document.createElement("a");
        link.href = url;
        link.setAttribute("download", "woocommerce_products.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <button
            onClick={handleExportWooCSV}
            className="px-6 py-3 bg-pink-600 text-white rounded hover:bg-pink-700"
        >
            Export to WooCommerce CSV
        </button>
    );
};