const video = document.getElementById("video");
const overlay = document.getElementById("overlay");
const overlayCtx = overlay.getContext("2d");
const emotionText = document.getElementById("emotion");
const confidenceText = document.getElementById("confidence");
const emotionChart = document.getElementById("emotion-chart");
const liveBar = document.getElementById("live-bar");
const pieChart = document.getElementById("pie-chart");
const cameraStatus = document.getElementById("camera-status");

const API_URL = "https://haden-emotion-api.onrender.com/predict_emotion";

const INFERENCE_INTERVAL_MS = 1100;
const FACE_PADDING_RATIO = 0.22;
const MIRROR_PREVIEW = true;
const API_TIMEOUT_MS = 6000;

const emotionCounts = {
  anger: 0,
  disgust: 0,
  fear: 0,
  happy: 0,
  neutral: 0,
  sad: 0,
  surprise: 0,
};

let totalDetections = 0;
let isDetecting = false;
let lastInferenceAt = 0;
let latestFaceBox = null;
let faceDetector = null;
let isFaceLoopRunning = false;
let isSendingFrame = false;
let noFaceFrames = 0;
let lastFaceSeenAt = 0;
let latestRequestId = 0;

const FACE_STALE_MS = 1200;

function renderChart() {
  emotionChart.innerHTML = "";

  Object.keys(emotionCounts).forEach((emotion) => {
    const count = emotionCounts[emotion];
    const percent =
      totalDetections === 0 ? 0 : Math.round((count / totalDetections) * 100);

    const row = document.createElement("div");
    row.classList.add("emotion-row");

    row.innerHTML = `
      <div class="emotion-label">
        <span>${emotion}</span>
        <span>${count} (${percent}%)</span>
      </div>
      <div class="emotion-bar-bg">
        <div class="emotion-bar" style="width:${percent}%"></div>
      </div>
    `;

    emotionChart.appendChild(row);
  });

  const colors = [
    "#8b5cf6",
    "#3b82f6",
    "#22c55e",
    "#f59e0b",
    "#ef4444",
    "#ec4899",
    "#14b8a6",
  ];

  let start = 0;

  const slices = Object.keys(emotionCounts).map((emotion, index) => {
    const percent =
      totalDetections === 0
        ? 0
        : (emotionCounts[emotion] / totalDetections) * 100;

    const end = start + percent;
    const slice = `${colors[index]} ${start}% ${end}%`;
    start = end;
    return slice;
  });

  pieChart.style.background =
    totalDetections === 0 ? "#0d1117" : `conic-gradient(${slices.join(",")})`;
}

function normalizeEmotion(rawEmotion) {
  const emotion = String(rawEmotion || "")
    .trim()
    .toLowerCase();

  const aliases = {
    angry: "anger",
    happiness: "happy",
    sadness: "sad",
    fearful: "fear",
    surprised: "surprise",
  };

  return aliases[emotion] || emotion;
}

function normalizeConfidence(rawConfidence) {
  const value = Number(rawConfidence || 0);
  if (Number.isNaN(value)) return 0;
  return value > 1 ? Math.min(value / 100, 1) : Math.min(value, 1);
}

function setStatus(message) {
  cameraStatus.innerText = message;
}

function resizeOverlayToVideo() {
  if (!video.videoWidth || !video.videoHeight) return;

  if (
    overlay.width !== video.videoWidth ||
    overlay.height !== video.videoHeight
  ) {
    overlay.width = video.videoWidth;
    overlay.height = video.videoHeight;
  }
}

function drawFaceBox(box) {
  resizeOverlayToVideo();
  overlayCtx.clearRect(0, 0, overlay.width, overlay.height);

  if (!box) return;

  const x = MIRROR_PREVIEW ? overlay.width - (box.x + box.width) : box.x;
  const y = box.y;

  overlayCtx.strokeStyle = "#22c55e";
  overlayCtx.lineWidth = Math.max(3, overlay.width * 0.006);
  overlayCtx.strokeRect(x, y, box.width, box.height);

  overlayCtx.fillStyle = "rgba(34, 197, 94, 0.92)";
  overlayCtx.fillRect(x, Math.max(y - 32, 0), Math.min(150, box.width), 26);

  overlayCtx.fillStyle = "#03130a";
  overlayCtx.font = `${Math.max(14, overlay.width * 0.024)}px Arial`;
  overlayCtx.fillText("Face detected", x + 9, Math.max(y - 13, 18));
}

function clampBox(box) {
  const x = Math.max(0, Math.min(box.x, video.videoWidth - 1));
  const y = Math.max(0, Math.min(box.y, video.videoHeight - 1));
  const width = Math.max(1, Math.min(box.width, video.videoWidth - x));
  const height = Math.max(1, Math.min(box.height, video.videoHeight - y));

  return { x, y, width, height };
}

function getBoxFromDetection(detection) {
  const relativeBox = detection?.locationData?.relativeBoundingBox;

  if (relativeBox) {
    return clampBox({
      x: relativeBox.xMin * video.videoWidth,
      y: relativeBox.yMin * video.videoHeight,
      width: relativeBox.width * video.videoWidth,
      height: relativeBox.height * video.videoHeight,
    });
  }

  const bbox = detection?.boundingBox;
  if (!bbox) return null;

  const width = bbox.width <= 1 ? bbox.width * video.videoWidth : bbox.width;
  const height =
    bbox.height <= 1 ? bbox.height * video.videoHeight : bbox.height;

  const xCenter =
    bbox.xCenter <= 1 ? bbox.xCenter * video.videoWidth : bbox.xCenter;
  const yCenter =
    bbox.yCenter <= 1 ? bbox.yCenter * video.videoHeight : bbox.yCenter;

  return clampBox({
    x: xCenter - width / 2,
    y: yCenter - height / 2,
    width,
    height,
  });
}

function getPaddedBox(box) {
  const padX = box.width * FACE_PADDING_RATIO;
  const padY = box.height * FACE_PADDING_RATIO;

  return clampBox({
    x: box.x - padX,
    y: box.y - padY,
    width: box.width + padX * 2,
    height: box.height + padY * 2,
  });
}

function createFaceBlob(box) {
  return new Promise((resolve) => {
    const padded = getPaddedBox(box);

    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 96;

    const ctx = canvas.getContext("2d");

    ctx.drawImage(
      video,
      padded.x,
      padded.y,
      padded.width,
      padded.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );

    canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.42);
  });
}

async function startCamera() {
  try {
    let stream;

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { exact: "user" },
          width: { ideal: 480 },
          height: { ideal: 360 },
        },
        audio: false,
      });
    } catch (frontCameraError) {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 480 },
          height: { ideal: 360 },
        },
        audio: false,
      });
    }

    video.srcObject = stream;
    await video.play();

    const boot = async () => {
      resizeOverlayToVideo();
      setStatus("Looking for face...");
      await setupFaceDetector();
      startFaceLoop();
    };

    video.onloadedmetadata = boot;

    if (video.readyState >= 2) {
      await boot();
    }
  } catch (error) {
    emotionText.innerText = "Camera Error";
    confidenceText.innerText = "Could not access camera.";
    setStatus("Camera permission needed");
    console.error(error);
  }
}

async function setupFaceDetector() {
  if (!window.FaceDetection) {
    setStatus("Face detector library failed");
    return;
  }

  if (faceDetector) return;

  faceDetector = new FaceDetection({
    locateFile: (file) =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/face_detection/${file}`,
  });

  faceDetector.setOptions({
    model: "short",
    minDetectionConfidence: 0.45,
  });

  faceDetector.onResults((results) => {
    const detections = results?.detections || [];

    if (detections.length === 0) {
      noFaceFrames += 1;
      const faceIsStale = Date.now() - lastFaceSeenAt > FACE_STALE_MS;

      if (noFaceFrames >= 8 && faceIsStale) {
        latestFaceBox = null;
        drawFaceBox(null);
        setStatus("No face detected");

        if (!isDetecting) {
          emotionText.innerText = "No face detected";
          confidenceText.innerText = "Confidence: 0%";
          liveBar.style.width = "0%";
        }
      }

      return;
    }

    lastFaceSeenAt = Date.now();
    noFaceFrames = 0;

    const boxes = detections.map(getBoxFromDetection).filter(Boolean);
    if (boxes.length === 0) return;

    boxes.sort((a, b) => b.width * b.height - a.width * a.height);

    latestFaceBox = boxes[0];
    drawFaceBox(latestFaceBox);

    if (!isDetecting) {
      setStatus("Face detected");
    }
  });
}

async function startFaceLoop() {
  if (!faceDetector || isFaceLoopRunning) return;

  isFaceLoopRunning = true;

  async function loop() {
    if (video.readyState >= 2 && !isSendingFrame) {
      try {
        isSendingFrame = true;
        await faceDetector.send({ image: video });
      } catch (error) {
        console.error(error);
      } finally {
        isSendingFrame = false;
      }
    }

    const now = Date.now();

    if (
      latestFaceBox &&
      !isDetecting &&
      now - lastInferenceAt >= INFERENCE_INTERVAL_MS
    ) {
      lastInferenceAt = now;
      detectEmotion(latestFaceBox);
    }

    requestAnimationFrame(loop);
  }

  loop();
}

async function detectEmotion(faceBox) {
  if (
    isDetecting ||
    !faceBox ||
    video.videoWidth === 0 ||
    video.videoHeight === 0
  ) {
    return;
  }

  isDetecting = true;
  setStatus("Analyzing...");

  const requestId = ++latestRequestId;

  try {
    const blob = await createFaceBlob(faceBox);
    if (!blob) throw new Error("Could not create face image.");

    const formData = new FormData();
    formData.append("file", blob, "face.jpg");

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    const response = await fetch(API_URL, {
      method: "POST",
      body: formData,
      cache: "no-store",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (requestId !== latestRequestId) return;

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();

    const emotion = normalizeEmotion(
      data.emotion || data.label || data.prediction,
    );

    const confidence = normalizeConfidence(
      data.confidence || data.score || data.probability,
    );

    const confidencePercent = Math.round(confidence * 100);

    if (
      !emotion ||
      !Object.prototype.hasOwnProperty.call(emotionCounts, emotion)
    ) {
      emotionText.innerText = "Unknown";
      confidenceText.innerText = `Confidence: ${confidencePercent}%`;
      liveBar.style.width = `${confidencePercent}%`;
      setStatus("Face detected");
      return;
    }

    emotionText.innerText = emotion;
    confidenceText.innerText = `Confidence: ${confidencePercent}%`;
    liveBar.style.width = `${confidencePercent}%`;

    emotionCounts[emotion] += 1;
    totalDetections += 1;

    renderChart();
    setStatus("Face detected");
  } catch (error) {
    if (error.name === "AbortError") {
      setStatus("Render is slow");
      confidenceText.innerText = "Waiting for Render response...";
    } else {
      setStatus("API Error");
      confidenceText.innerText = "Check Render service.";
    }

    console.error(error);
  } finally {
    isDetecting = false;
  }
}

window.addEventListener("resize", () => {
  resizeOverlayToVideo();
  drawFaceBox(latestFaceBox);
});

renderChart();
startCamera();
