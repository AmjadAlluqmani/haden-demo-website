const setupBox = document.getElementById("setup-box");
const avatarSection = document.getElementById("avatar-section");

const childNameInput = document.getElementById("child-name");
const childGenderSelect = document.getElementById("child-gender");
const childAgeSelect = document.getElementById("child-age");
const startBtn = document.getElementById("start-btn");

const textModeBtn = document.getElementById("text-mode-btn");
const voiceModeBtn = document.getElementById("voice-mode-btn");

const textPanel = document.getElementById("text-panel");
const voicePanel = document.getElementById("voice-panel");

const chatBox = document.getElementById("chat-box");
const input = document.getElementById("message-input");
const sendBtn = document.getElementById("send-btn");
const endBtn = document.getElementById("end-btn");
const reportBox = document.getElementById("report-box");

const voiceVisualizer = document.getElementById("voice-visualizer");
const voiceStatus = document.getElementById("voice-status");
const voiceTranscript = document.getElementById("voice-transcript");

const noorVideo = document.getElementById("noor-video");

const API_URL = "https://haden-noor-api.onrender.com";

const INTRO_VIDEO = "assets/noor_intro.mp4";
const WAITING_VIDEO = "assets/noor_waiting.mp4";

let sessionStarted = false;
let childData = null;

let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let silenceTimer = null;
let audioContext = null;
let analyser = null;
let micStream = null;

const SILENCE_THRESHOLD = 0.01;
const SILENCE_DELAY = 1800;
let sessionEnded = false;

function playVideo(src, loop = false, muted = false) {
  noorVideo.pause();
  noorVideo.src = src;
  noorVideo.loop = loop;
  noorVideo.muted = muted;
  noorVideo.load();

  noorVideo.play().catch((error) => {
    console.log("Video play blocked:", error);
  });
}

function addMessage(text, type) {
  const div = document.createElement("div");
  div.classList.add("message", type);
  div.innerText = text;
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function setVoiceUI(status, mode = "idle") {
  voiceStatus.innerText = status;

  voiceVisualizer.classList.remove("listening", "thinking");

  if (mode === "listening") {
    voiceVisualizer.classList.add("listening");
  }

  if (mode === "thinking") {
    voiceVisualizer.classList.add("thinking");
  }
}

function setMode(mode) {
  if (mode === "text") {
    textPanel.style.display = "block";
    voicePanel.style.display = "none";

    textModeBtn.classList.add("active");
    voiceModeBtn.classList.remove("active");

    stopRecording(false);
    setVoiceUI("Tap the circle and speak", "idle");
  } else {
    textPanel.style.display = "none";
    voicePanel.style.display = "flex";

    voiceModeBtn.classList.add("active");
    textModeBtn.classList.remove("active");

    setVoiceUI("Tap the circle and speak", "idle");
  }
}

async function startSession() {
  const childName = childNameInput.value.trim();
  const childGender = childGenderSelect.value;
  const childAge = Number(childAgeSelect.value);

  if (!childName || !childGender || !childAge) {
    alert("Please enter name, gender, and age.");
    return;
  }

  childData = {
    childName,
    childAge,
    childGender,
    adoptionDuration: "Demo",
    familyInfo: "Demo User",
    sessionNumber: 1,
  };

  try {
    const response = await fetch(`${API_URL}/start_session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(childData),
    });

    const data = await response.json();

    if (data.ok) {
      sessionStarted = true;
      sessionEnded = false;

      setupBox.style.display = "none";
      avatarSection.style.display = "block";

      addMessage(`هلا ${childName}! أنا نور 💛`, "bot");

      playVideo(INTRO_VIDEO, false, false);
      setMode("text");
    } else {
      alert("Could not start session.");
    }
  } catch (error) {
    alert("Error connecting to Noor API.");
    console.log(error);
  }
}

async function sendMessage() {
  const message = input.value.trim();

  if (!message || !sessionStarted || sessionEnded) return;

  addMessage(message, "user");
  input.value = "";

  try {
    playVideo(WAITING_VIDEO, true, true);
    addMessage("Noor is thinking...", "bot");

    const response = await fetch(`${API_URL}/talk_avatar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });

    const data = await response.json();

    chatBox.lastChild.remove();

    if (data.error) {
      addMessage("Error: " + data.error, "bot");
      playVideo(INTRO_VIDEO, false, false);
      return;
    }

    addMessage(data.noorReply, "bot");

    if (data.videoUrl) {
      playVideo(data.videoUrl, false, false);
    } else {
      playVideo(INTRO_VIDEO, false, false);
    }

    if (data.shouldEnd) {
      await endSession();
    }
  } catch (error) {
    addMessage("Error connecting to Noor API", "bot");
    console.log(error);
    playVideo(INTRO_VIDEO, false, false);
  }
}

async function startRecording() {
  if (isRecording || sessionEnded || !sessionStarted) return;

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert("Microphone is not supported in this browser.");
    return;
  }

  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });

    audioChunks = [];
    mediaRecorder = new MediaRecorder(micStream);

    audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(micStream);

    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;

    source.connect(analyser);

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = async () => {
      const audioBlob = new Blob(audioChunks, { type: "audio/webm" });

      cleanupMic();

      if (sessionEnded) return;

      if (audioBlob.size > 1000) {
        await sendAudio(audioBlob);
      } else {
        setVoiceUI("I did not hear anything. Tap again.", "idle");
      }
    };

    mediaRecorder.start();
    isRecording = true;

    setVoiceUI("Listening...", "listening");
    voiceTranscript.innerText = "";

    monitorSilence();
  } catch (error) {
    console.log(error);
    alert("Could not access microphone.");
  }
}

function monitorSilence() {
  const dataArray = new Uint8Array(analyser.fftSize);
  let heardSpeech = false;

  function checkAudio() {
    if (!isRecording || !analyser) return;

    analyser.getByteTimeDomainData(dataArray);

    let sum = 0;

    for (let i = 0; i < dataArray.length; i++) {
      const value = (dataArray[i] - 128) / 128;
      sum += value * value;
    }

    const volume = Math.sqrt(sum / dataArray.length);

    if (volume > SILENCE_THRESHOLD) {
      heardSpeech = true;

      clearTimeout(silenceTimer);

      silenceTimer = setTimeout(() => {
        stopRecording(true);
      }, SILENCE_DELAY);
    }

    requestAnimationFrame(checkAudio);
  }

  silenceTimer = setTimeout(() => {
    if (heardSpeech) {
      stopRecording(true);
    } else {
      stopRecording(false);
      setVoiceUI("I did not hear anything. Tap again.", "idle");
    }
  }, 6000);

  checkAudio();
}

function stopRecording(send = true) {
  if (!mediaRecorder || !isRecording) {
    cleanupMic();
    return;
  }

  isRecording = false;
  clearTimeout(silenceTimer);

  if (send) {
    setVoiceUI("Noor is thinking...", "thinking");
    playVideo(WAITING_VIDEO, true, true);
  }

  mediaRecorder.stop();
}

function cleanupMic() {
  if (micStream) {
    micStream.getTracks().forEach((track) => track.stop());
    micStream = null;
  }

  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }

  analyser = null;
}

async function sendAudio(audioBlob) {
  if (!sessionStarted || sessionEnded) return;

  try {
    const formData = new FormData();
    formData.append("file", audioBlob, "voice.webm");

    const response = await fetch(`${API_URL}/talk`, {
      method: "POST",
      body: formData,
    });

    const data = await response.json();

    if (data.error) {
      setVoiceUI("Error: " + data.error, "idle");
      playVideo(INTRO_VIDEO, false, false);
      return;
    }

    voiceTranscript.innerText = data.childText
      ? `You said: ${data.childText}`
      : "";

    if (data.noorReply) {
      addMessage(data.noorReply, "bot");
    }

    if (data.videoUrl) {
      playVideo(data.videoUrl, false, false);
    } else {
      playVideo(INTRO_VIDEO, false, false);
    }

    setVoiceUI("Tap the circle and speak", "idle");

    if (data.shouldEnd) {
      await endSession();
    }
  } catch (error) {
    setVoiceUI("Error connecting to Noor API", "idle");
    console.log(error);
    playVideo(INTRO_VIDEO, false, false);
  }
}

async function endSession() {
  try {
    sessionEnded = true;
    stopRecording(false);

    playVideo(WAITING_VIDEO, true, true);
    addMessage("Generating session report...", "bot");

    const response = await fetch(`${API_URL}/end_session`, {
      method: "POST",
    });

    const data = await response.json();

    chatBox.lastChild.remove();

    if (data.error) {
      addMessage("Error: " + data.error, "bot");
      noorVideo.pause();
      return;
    }

    const report = data.report || {};

    reportBox.style.display = "block";
    reportBox.innerHTML = `
  <h2 class="report-main-title">تقرير الجلسة</h2>

  <div class="clean-report-section">
    <h3>ملخص الجلسة</h3>
    <p>${report.session_summary || "لا يوجد ملخص متاح."}</p>
  </div>

  <div class="clean-report-section">
    <h3>الحالة العاطفية</h3>
    <p>
      <strong>المشاعر السائدة:</strong>
      ${report.emotional_state?.dominant || "-"}
    </p>

    <p>
      <strong>الاستقرار العاطفي:</strong>
      ${report.emotional_state?.stability || "-"}
    </p>
  </div>

  <div class="clean-report-section">
    <h3>مستوى الخطورة</h3>

    <p>
      ${
        report.red_flags && report.red_flags.length > 0
          ? report.red_flags.join("، ")
          : "لا توجد مؤشرات خطر"
      }
    </p>
  </div>

  <div class="clean-report-section">
    <h3>التوصيات</h3>

    <ul>
      ${
        report.recommendations && report.recommendations.length > 0
          ? report.recommendations.map((item) => `<li>${item}</li>`).join("")
          : "<li>لا توجد توصيات متاحة.</li>"
      }
    </ul>
  </div>
`;

    addMessage("Session ended. The report is shown below.", "bot");

    input.disabled = true;
    sendBtn.disabled = true;
    endBtn.style.display = "none";
    textModeBtn.disabled = true;
    voiceModeBtn.disabled = true;

    setVoiceUI("Session ended.", "idle");
    noorVideo.pause();
  } catch (error) {
    addMessage("Error ending session.", "bot");
    console.log(error);
    noorVideo.pause();
  }
}

startBtn.addEventListener("click", startSession);
sendBtn.addEventListener("click", sendMessage);
endBtn.addEventListener("click", endSession);

textModeBtn.addEventListener("click", () => setMode("text"));
voiceModeBtn.addEventListener("click", () => setMode("voice"));

voiceVisualizer.addEventListener("click", () => {
  if (!isRecording && !sessionEnded) {
    startRecording();
  }
});

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    sendMessage();
  }
});
