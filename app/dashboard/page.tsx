'use client';
import React, { useState, useEffect, useCallback, useRef } from "react";
import Image from "next/image";
import Cookies from 'js-cookie';

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  webContentLink: string;
  webViewLink: string;
}

export default function DashboardPage() {
  const [folderId, setFolderId] = useState<string>("");
  const [images, setImages] = useState<DriveFile[]>([]);
  const [currentImageIndex, setCurrentImageIndex] = useState<number>(0);
  const [scores, setScores] = useState<number[]>(Array(6).fill(0));
  const [comments, setComments] = useState<string>("N/A");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [focusedCriterionIndex, setFocusedCriterionIndex] = useState<number | null>(null);
  // State for zoom and pan
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const [startPan, setStartPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const imageContainerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  const imageLoader = ({ src, width, quality }: { src: string; width: number; quality?: number }) => {
    const accessToken = Cookies.get('google_access_token');
    const url = new URL(src, window.location.origin);
    if (accessToken) {
      url.searchParams.set('accessToken', accessToken);
    }
    url.searchParams.set('w', width.toString());
    if (quality) {
      url.searchParams.set('q', quality.toString());
    }
    return url.toString();
  };

  const preloadImage = (url: string) => {
    // Using typeof window.Image to access the browser's global Image constructor
    // as 'Image' might not be directly recognized in some Next.js environments or during SSR.
    const img = new (window.Image as typeof window.Image)();
    img.src = url;
  };

  const criteria = [
    "Mid-sagittal section",
    "Neutral position",
    "Horizontal orientation",
    "Crown and rump clearly visible",
    "Correct caliper placement",
    "Good magnification",
  ];

  const descriptions = [
    "Midline facial profile, fetal spine and rump should all be visible in one complete image",
    "There should be fluid visible between the chin and the chest of the fetus and the 'profile line' should form an acute angle with the CRL line before the rump",
    "Fetus should be horizontal with line connecting crown and rump positioned between 75° and 105° to ultrasound beam",
    "Crown and rump should both be clearly visible",
    "Intersection of calipers should be on outer border of skin covering skull and outer border of skin covering rump",
    "Fetus should fill more than two-thirds of image, clearly showing crown and rump",
  ];

  const currentImage = images[currentImageIndex];

  const handleSave = useCallback(async () => {
    if (!currentImage) {
      alert("No image to save.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const accessToken = Cookies.get('google_access_token');
      const idToken = Cookies.get('google_id_token');

      if (!accessToken || !idToken) {
        throw new Error("Authentication tokens not found in client-side cookies.");
      }

      const response = await fetch('/api/labels', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'X-Google-Id-Token': idToken,
        },
        // credentials: 'include', // Not needed as tokens are in headers
        body: JSON.stringify({
          imageId: currentImage.id,
          imageName: currentImage.name,
          scores,
          comments,
          folderId,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to save labeling data');
      }

      const result = await response.json();
      alert(result.message);
    } catch (err: unknown) {
      setError((err as Error).message);
      alert(`Error saving data: ${(err as Error).message}`);
    } finally {
      setIsLoading(false);
    }
  }, [currentImage, scores, comments, folderId]);

  // Effect for image zoom and pan
  useEffect(() => {
    const container = imageContainerRef.current;
    const img = imageRef.current;

    if (!container || !img) return;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();

      const scaleAmount = 1.1; // Zoom in/out factor
      const rect = container.getBoundingClientRect();
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;

      setZoomLevel((prevZoom) => {
        let newZoom = event.deltaY < 0 ? prevZoom * scaleAmount : prevZoom / scaleAmount;
        newZoom = Math.max(1, Math.min(newZoom, 5)); // Limit zoom between 1x and 5x

        // Adjust pan to zoom towards mouse cursor
        const currentImageWidth = img.naturalWidth * prevZoom;
        const currentImageHeight = img.naturalHeight * prevZoom;

        const newImageWidth = img.naturalWidth * newZoom;
        const newImageHeight = img.naturalHeight * newZoom;

        const offsetX = (mouseX / currentImageWidth) * (newImageWidth - currentImageWidth);
        const offsetY = (mouseY / currentImageHeight) * (newImageHeight - currentImageHeight);

        setPan((prevPan) => ({ x: prevPan.x - offsetX, y: prevPan.y - offsetY }));

        return newZoom;
      });
    };

    const handleMouseDown = (event: MouseEvent) => {
      if (zoomLevel > 1) {
        setIsPanning(true);
        setStartPan({ x: event.clientX - pan.x, y: event.clientY - pan.y });
        container.style.cursor = 'grabbing';
      }
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (!isPanning) return;
      setPan({ x: event.clientX - startPan.x, y: event.clientY - startPan.y });
    };

    const handleMouseUp = () => {
      setIsPanning(false);
      container.style.cursor = 'grab';
    };

    const handleDoubleClick = () => {
      setZoomLevel(1);
      setPan({ x: 0, y: 0 });
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    container.addEventListener('mousedown', handleMouseDown);
    container.addEventListener('dblclick', handleDoubleClick);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('mousedown', handleMouseDown);
      container.removeEventListener('dblclick', handleDoubleClick);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [zoomLevel, pan, isPanning, startPan]);

  // Effect to read tokens from URL and set client-side cookies
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const accessToken = params.get('access_token');
    const idToken = params.get('id_token');

    const isProduction = process.env.NODE_ENV === 'production';
    const cookieOptions = { expires: 7, sameSite: 'Lax' as const, secure: isProduction };

    if (accessToken) {
      Cookies.set('google_access_token', accessToken, cookieOptions);
      params.delete('access_token');
    }
    if (idToken) {
      Cookies.set('google_id_token', idToken, cookieOptions);
      params.delete('id_token');
    }

    // Clean the URL
    if (accessToken || idToken) {
      window.history.replaceState({}, document.title, `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`);
    }
  }, []);

  useEffect(() => {
    const fetchImages = async () => {
      if (!folderId) {
        setImages([]);
        return;
      }
      setIsLoading(true);
      setError(null);
      try {
        const accessToken = Cookies.get('google_access_token');
        if (!accessToken) {
          throw new Error("Access token not found in client-side cookies.");
        }

        const response = await fetch(`/api/drive?folderId=${folderId}`, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
        });
        if (!response.ok) {
          throw new Error(`Error: ${response.status} ${response.statusText}`);
        }
        const data: DriveFile[] = await response.json();
        setImages(data);
        setCurrentImageIndex(0);
        setScores(Array(6).fill(0));
        setComments("N/A");
      } catch (err: unknown) {
        setError((err as Error).message);
        setImages([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchImages();
  }, [folderId]);

  useEffect(() => {
    if (images.length > 0) {
      // Reset zoom and pan when image changes
      setZoomLevel(1);
      setPan({ x: 0, y: 0 });

      // Preload next image
      const nextImageIndex = currentImageIndex + 1;
      if (nextImageIndex < images.length) {
        preloadImage(`/api/drive?fileId=${images[nextImageIndex].id}`);
      }
    }
  }, [currentImageIndex, images]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isLoading) return;

      if (event.key === 'ArrowLeft') {
        setCurrentImageIndex((prev) => Math.max(0, prev - 1));
        setFocusedCriterionIndex(null); // Reset focus when navigating
      } else if (event.key === 'ArrowRight') {
        setCurrentImageIndex((prev) => Math.min(images.length - 1, prev + 1));
        setFocusedCriterionIndex(null); // Reset focus when navigating
      } else if (event.key >= '1' && event.key <= '6') {
        // Select a criterion (1-based index to 0-based)
        setFocusedCriterionIndex(parseInt(event.key, 10) - 1);
      } else if ((event.key === '0' || event.key === '1') && focusedCriterionIndex !== null) {
        // Set score for the focused criterion
        const scoreValue = parseInt(event.key, 10);
        const newScores = [...scores];
        newScores[focusedCriterionIndex] = scoreValue;
        setScores(newScores);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [currentImageIndex, images, isLoading, scores, focusedCriterionIndex, handleSave]);

  const handleScoreChange = (index: number, value: string) => {
    const newScores = [...scores];
    newScores[index] = parseInt(value, 10) || 0;
    setScores(newScores);
  };

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-3xl font-bold mb-6 text-center">
        Ultrasound Quality Scoring Tools - CRL measurement
      </h1>

      {isLoading && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-75 flex items-center justify-center z-50">
          <div className="text-white text-xl">Loading...</div>
        </div>
      )}

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4" role="alert">
          <strong className="font-bold">Error! </strong>
          <span className="block sm:inline">{error}</span>
          <span className="absolute top-0 bottom-0 right-0 px-4 py-3">
            <svg className="fill-current h-6 w-6 text-red-500" role="button" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" onClick={() => setError(null)}><title>Close</title><path d="M14.348 14.849a1.2 1.2 0 0 1-1.697 0L10 11.819l-2.651 3.029a1.2 1.2 0 1 1-1.697-1.697l2.758-3.15-2.759-3.152a1.2 1.2 0 1 1 1.697-1.697L10 8.183l2.651-3.031a1.2 1.2 0 1 1 1.697 1.697l-2.758 3.152 2.758 3.15a1.2 1.2 0 0 1 0 1.698z"/></svg>
          </span>
        </div>
      )}

      <div className="mb-4">
        <label htmlFor="folderId" className="block text-lg font-medium text-gray-700">
          Google Drive Folder ID:
        </label>
        <input
          type="text"
          id="folderId"
          value={folderId}
          onChange={(e) => setFolderId(e.target.value)}
          className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
          placeholder="Enter Google Drive Folder ID"
          disabled={isLoading}
        />
      </div>

      {images.length > 0 && currentImage ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="image-viewer">
            <h2 className="text-xl font-semibold mb-4">
              Image: {currentImage.name} ({currentImageIndex + 1} of {images.length})
            </h2>
            <div ref={imageContainerRef} className="relative w-full h-96 bg-gray-200 flex items-center justify-center rounded-md overflow-hidden" style={{ cursor: zoomLevel > 1 ? (isPanning ? 'grabbing' : 'grab') : 'default' }}>
              <Image
                ref={imageRef}
                loader={imageLoader}
                src={`/api/drive?fileId=${currentImage.id}`}
                alt={currentImage.name}
                style={{
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoomLevel})`,
                  transformOrigin: '0 0',
                }}
                width={500} // Example width, adjust as needed
                height={500} // Example height, adjust as needed
                className="rounded-md"
              />
            </div>
            <div className="flex justify-between mt-4">
              <button
                onClick={() => setCurrentImageIndex((prev) => Math.max(0, prev - 1))}
                disabled={currentImageIndex === 0 || isLoading}
                className="px-4 py-2 bg-blue-500 text-white rounded-md disabled:bg-gray-400"
              >
                Previous
              </button>
              <button
                onClick={() =>
                  setCurrentImageIndex((prev) => Math.min(images.length - 1, prev + 1))
                }
                disabled={currentImageIndex === images.length - 1 || isLoading}
                className="px-4 py-2 bg-blue-500 text-white rounded-md disabled:bg-gray-400"
              >
                Next
              </button>
            </div>
          </div>

          <div className="labeling-interface">
            <h2 className="text-xl font-semibold mb-4">CRL measurement</h2>
            <p className="text-sm text-gray-500 mb-4">
              Reference: <a href="https://obgyn.onlinelibrary.wiley.com/doi/10.1002/uog.13376" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Table 1. Image-scoring criteria for crown-rump length (CRL) measurement</a>
            </p>
            <div className="overflow-x-auto">
              <table className="min-w-full bg-white border border-gray-200 rounded-md">
                <thead>
                  <tr className="bg-gray-100 border-b">
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-700">#</th>
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-700">Criterion</th>
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-700">Description</th>
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-700">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {criteria.map((criterion, index) => (
                    <tr
                      key={index}
                      className={`border-b last:border-b-0 ${focusedCriterionIndex === index ? 'bg-blue-100' : ''}`}
                    >
                      <td className="px-4 py-2 text-sm text-gray-800">{index + 1}.</td>
                      <td className="px-4 py-2 text-sm text-gray-800">{criterion}</td>
                      <td className="px-4 py-2 text-sm text-gray-600">{descriptions[index]}</td>
                      <td className="px-4 py-2">
                        <input
                          type="number"
                          min="0"
                          max="1" // Assuming scores are binary (0 or 1) based on the image
                          value={scores[index]}
                          onChange={(e) => handleScoreChange(index, e.target.value)}
                          className="w-20 border border-gray-300 rounded-md shadow-sm p-1 text-center"
                          disabled={isLoading}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-6">
              <h3 className="text-lg font-semibold mb-2">Comments</h3>
              <textarea
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                rows={4}
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                placeholder="Enter comments here..."
                disabled={isLoading}
              ></textarea>
            </div>

            <div className="flex justify-end mt-6">
              <button
                onClick={handleSave}
                className="px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400"
                disabled={isLoading}
              >
                SAVE
              </button>
              {/* <button className="ml-4 px-6 py-2 bg-yellow-500 text-white rounded-md hover:bg-yellow-600">
                SAVE WITH MISSING DATA
              </button> */}
              <button
                onClick={() => console.log("Cancel")} // Placeholder for cancel action
                className="ml-4 px-6 py-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400 disabled:bg-gray-400"
                disabled={isLoading}
              >
                CANCEL
              </button>
            </div>
          </div>
        </div>
      ) : (
        !isLoading && !error && folderId && (
          <p className="text-center text-gray-600">No images found in this folder.</p>
        )
      )}
    </div>
  );
}
