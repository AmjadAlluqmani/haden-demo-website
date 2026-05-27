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
const INFERENCE_INTERVAL_MS = 1200;
const FACE_PADDING_RATIO = 0.18;

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

  // The video preview is mirrored with CSS, so the rectangle must be mirrored too.
  const mirroredX = overlay.width - (box.x + box.width);

  overlayCtx.strokeStyle = "#22c55e";
  overlayCtx.lineWidth = Math.max(3, overlay.width * 0.006);
  overlayCtx.strokeRect(mirroredX, box.y, box.width, box.height);

  overlayCtx.fillStyle = "rgba(34, 197, 94, 0.92)";
  overlayCtx.fillRect(
    mirroredX,
    Math.max(box.y - 34, 0),
    Math.min(150, box.width),
    28,
  );

  overlayCtx.fillStyle = "#03130a";
  overlayCtx.font = `${Math.max(15, overlay.width * 0.025)}px Arial`;
  overlayCtx.fillText(
    "Face detected",
    mirroredX + 10,
    Math.max(box.y - 13, 20),
  );
}

function getPaddedBox(box) {
  const padX = box.width * FACE_PADDING_RATIO;
  const padY = box.height * FACE_PADDING_RATIO;

  const x = Math.max(0, box.x - padX);
  const y = Math.max(0, box.y - padY);
  const width = Math.min(video.videoWidth - x, box.width + padX * 2);
  const height = Math.min(video.videoHeight - y, box.height + padY * 2);

  return { x, y, width, height };
}

function createFaceBlob(box) {
  return new Promise((resolve) => {
    const padded = getPaddedBox(box);
    const canvas = document.createElement("canvas");
    canvas.width = 224;
    canvas.height = 224;

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
    canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.9);
  });
}

async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 640 },
        height: { ideal: 480 },
      },
      audio: false,
    });

    video.srcObject = stream;

    video.onloadedmetadata = async () => {
      resizeOverlayToVideo();
      setStatus("Looking for face...");
      await setupFaceDetector();
      startFaceLoop();
    };
  } catch (error) {
    emotionText.innerText = "Camera Error";
    confidenceText.innerText = "Could not access camera.";
    setStatus("Camera permission needed");
    console.error(error);
  }
}

async function setupFaceDetector() {
  if (!window.FaceDetection) {
    setStatus("Face detector failed to load");
    return;
  }

  faceDetector = new FaceDetection({
    locateFile: (file) =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/face_detection/${file}`,
  });

  faceDetector.setOptions({
    model: "short",
    minDetectionConfidence: 0.65,
  });

  faceDetector.onResults((results) => {
    if (!results.detections || results.detections.length === 0) {
      latestFaceBox = null;
      drawFaceBox(null);
      setStatus("No face detected");
      emotionText.innerText = "No face detected";
      confidenceText.innerText = "Confidence: 0%";
      liveBar.style.width = "0%";
      return;
    }

    const detection = results.detections[0];
    const bbox = detection.boundingBox;

    latestFaceBox = {
      x: bbox.xCenter * video.videoWidth - (bbox.width * video.videoWidth) / 2,
      y:
        bbox.yCenter * video.videoHeight -
        (bbox.height * video.videoHeight) / 2,
      width: bbox.width * video.videoWidth,
      height: bbox.height * video.videoHeight,
    };

    drawFaceBox(latestFaceBox);
    setStatus(isDetecting ? "Analyzing..." : "Face detected");
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
    if (latestFaceBox && now - lastInferenceAt >= INFERENCE_INTERVAL_MS) {
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
  )
    return;

  isDetecting = true;
  setStatus("Analyzing...");

  try {
    const blob = await createFaceBlob(faceBox);
    if (!blob) throw new Error("Could not create face image.");

    const formData = new FormData();
    formData.append("file", blob, "face.jpg");

    const response = await fetch(API_URL, {
      method: "POST",
      body: formData,
    });

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
      return;
    }

    emotionText.innerText = emotion;
    confidenceText.innerText = `Confidence: ${confidencePercent}%`;
    liveBar.style.width = `${confidencePercent}%`;

    emotionCounts[emotion] += 1;
    totalDetections += 1;
    renderChart();
  } catch (error) {
    emotionText.innerText = "API Error";
    confidenceText.innerText = "Check the backend link or Render service.";
    setStatus("API Error");
    console.error(error);
  } finally {
    isDetecting = false;
  }
}

renderChart();
startCamera();
