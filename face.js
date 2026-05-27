const video = document.getElementById("video");
const emotionText = document.getElementById("emotion");
const confidenceText = document.getElementById("confidence");
const emotionChart = document.getElementById("emotion-chart");
const liveBar = document.getElementById("live-bar");
const pieChart = document.getElementById("pie-chart");

const API_URL = "https://haden-emotion-api.onrender.com/predict_emotion";

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
    const count = emotionCounts[emotion];
    const percent = totalDetections === 0 ? 0 : (count / totalDetections) * 100;

    const end = start + percent;
    const slice = `${colors[index]} ${start}% ${end}%`;
    start = end;

    return slice;
  });

  pieChart.style.background =
    totalDetections === 0 ? "#0d1117" : `conic-gradient(${slices.join(",")})`;
}

async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
    });

    video.srcObject = stream;
  } catch (error) {
    emotionText.innerText = "Camera Error";
    confidenceText.innerText = "Could not access camera.";
    console.log(error);
  }
}

async function detectEmotion() {
  if (isDetecting) return;
  if (video.videoWidth === 0 || video.videoHeight === 0) return;

  isDetecting = true;

  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0);

  canvas.toBlob(async (blob) => {
    const formData = new FormData();
    formData.append("file", blob, "frame.jpg");

    try {
      const response = await fetch(API_URL, {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      const emotion = String(data.emotion || "").toLowerCase();
      const confidence = data.confidence ?? 0;

      emotionText.innerText = emotion || "Unknown";
      confidenceText.innerText = "Confidence: " + confidence;
      liveBar.style.width = `${Math.round(confidence * 100)}%`;

      if (emotionCounts.hasOwnProperty(emotion)) {
        emotionCounts[emotion] += 1;
        totalDetections += 1;
        renderChart();
      }
    } catch (error) {
      emotionText.innerText = "Error";
      console.log(error);
    } finally {
      isDetecting = false;
    }
  }, "image/jpeg");
}

renderChart();
startCamera();

setInterval(() => {
  detectEmotion();
}, 2500);
