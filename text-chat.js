const setupBox = document.getElementById("setup-box");
const chatSection = document.getElementById("chat-section");

const childNameInput = document.getElementById("child-name");
const childGenderSelect = document.getElementById("child-gender");
const childAgeSelect = document.getElementById("child-age");
const startBtn = document.getElementById("start-btn");

const chatBox = document.getElementById("chat-box");
const input = document.getElementById("message-input");
const sendBtn = document.getElementById("send-btn");
const endBtn = document.getElementById("end-btn");
const reportBox = document.getElementById("report-box");

const API_URL = "https://haden-noor-api.onrender.com";

let sessionStarted = false;
let childData = null;

function addMessage(text, type) {
  const div = document.createElement("div");
  div.classList.add("message", type);
  div.innerText = text;
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
}

async function startSession() {
  const childName = childNameInput.value.trim();
  const childGender = childGenderSelect.value;
  const childAge = Number(childAgeSelect.value);

  if (!childName || !childGender || !childAge) {
    alert("Please enter name, gender, and age.");
    return;
  }
  startBtn.disabled = true;
  startBtn.innerText = "Starting...";

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
      setupBox.style.display = "none";
      chatSection.style.display = "block";

      addMessage(
        `هلا ${childName}! أنا نور، اكتبي لي أي شيء تبغي نتكلم عنه 💛`,
        "bot",
      );
    } else {
      alert("Could not start session.");
    }
  } catch (error) {
    alert("Error connecting to Noor API.");
    console.log(error);
    startBtn.disabled = false;
    startBtn.innerText = "Start Session";
  }
}

async function sendMessage() {
  const message = input.value.trim();

  if (!message || !sessionStarted) return;

  addMessage(message, "user");
  input.value = "";

  try {
    addMessage("Noor is thinking...", "bot");

    const response = await fetch(`${API_URL}/talk_text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });

    const data = await response.json();

    chatBox.lastChild.remove();

    if (data.error) {
      addMessage("Error: " + data.error, "bot");
      return;
    }

    addMessage(data.noorReply, "bot");

    if (data.shouldEnd) {
      await endSession();
    }
  } catch (error) {
    addMessage("Error connecting to Noor API", "bot");
    console.log(error);
  }
}

async function endSession() {
  endBtn.style.display = "none";
  input.disabled = true;
  sendBtn.disabled = true;

  try {
    addMessage("Generating session report...", "bot");

    const response = await fetch(`${API_URL}/end_session`, {
      method: "POST",
    });

    const data = await response.json();

    chatBox.lastChild.remove();

    if (data.error) {
      addMessage("Error: " + data.error, "bot");
      return;
    }

    const report = data.report || {};

    reportBox.style.display = "block";

    reportBox.innerHTML = `
      <h2 class="report-main-title">Report</h2>

      <div class="clean-report-section">
        <h3>Session Summary</h3>
        <p>${report.session_summary || "No summary available."}</p>
      </div>

      <div class="clean-report-section">
        <h3>Emotional State</h3>
        <p><strong>Dominant Emotion:</strong> ${report.emotional_state?.dominant || "-"}</p>
        <p><strong>Stability:</strong> ${report.emotional_state?.stability || "-"}</p>
      </div>

      <div class="clean-report-section">
        <h3>Risk Status</h3>
        <p>${
          report.red_flags && report.red_flags.length > 0
            ? report.red_flags.join(", ")
            : "No risk detected"
        }</p>
      </div>

      <div class="clean-report-section">
        <h3>Recommendations</h3>
        <ul>
          ${
            report.recommendations && report.recommendations.length > 0
              ? report.recommendations
                  .map((item) => `<li>${item}</li>`)
                  .join("")
              : "<li>No recommendations available.</li>"
          }
        </ul>
      </div>
    `;

    addMessage("Session ended. The report is ready.", "bot");
  } catch (error) {
    addMessage("Error ending session.", "bot");
    console.log(error);
  }
}

startBtn.addEventListener("click", startSession);
sendBtn.addEventListener("click", sendMessage);
endBtn.addEventListener("click", endSession);

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    sendMessage();
  }
});
