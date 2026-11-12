(() => {
  "use strict";

  const passages = [
    "Small daily habits can lead to remarkable changes over time. Stay curious, keep learning, and give yourself room to grow.",
    "The best ideas often arrive when we slow down enough to notice the details around us. Take a breath and enjoy the moment.",
    "A quiet morning, a warm cup of tea, and a fresh page can make an ordinary day feel full of possibility.",
    "Technology moves quickly, but clear thinking and thoughtful communication will always make a meaningful difference.",
    "Every great journey begins with one small step. Focus on the next thing in front of you, and let progress build naturally.",
    "The secret of getting ahead is getting started. The secret of getting started is breaking complex tasks into small steps.",
    "Creativity is a way of looking at familiar things from a different angle. Make space for ideas, and see where they take you.",
    "A good book opens a window into another world. A good conversation helps us see the world we already share.",
    "Practice turns effort into instinct. Show up with patience, notice what improves, and celebrate the progress you make.",
    "On a clear night, the stars remind us how much there is to explore. Wonder is a wonderful place to begin."
  ];

  const BEST_KEY = "typora.personalBest";
  const LEGACY_BEST_KEY = "typefast.personalBest";
  const SCORE_NAME_KEY = "typora.scoreName";
  const state = {
    duration: 60,
    mode: "solo",
    startedAt: null,
    intervalId: null,
    isFinished: false,
    passage: "",
    lastPassageIndex: -1,
    finalResult: null,
    botWpm: 0,
    socket: null,
    socketLoadPromise: null,
    roomCode: null,
    roomRound: null,
    roomReady: false,
    roomStarted: false,
    roomPlayers: [],
    lastProgressAt: 0,
    playerName: "",
    scoreSavingFor: null,
    scoreSavedFor: null,
    notificationTimeoutId: null
  };

  const elements = {
    passage: document.querySelector("#passage"),
    passageArea: document.querySelector("#passage-area"),
    input: document.querySelector("#typing-input"),
    startPrompt: document.querySelector("#start-prompt"),
    wpm: document.querySelector("#wpm-value"),
    accuracy: document.querySelector("#accuracy-value"),
    time: document.querySelector("#time-value"),
    best: document.querySelector("#best-value"),
    status: document.querySelector("#game-status"),
    characterCount: document.querySelector("#character-count"),
    durationButtons: [...document.querySelectorAll(".duration-button")],
    restartButton: document.querySelector("#restart-button"),
    resultCard: document.querySelector("#result-card"),
    resultTitle: document.querySelector("#result-title"),
    resultWpm: document.querySelector("#result-wpm"),
    resultAccuracy: document.querySelector("#result-accuracy"),
    resultMessage: document.querySelector("#result-message"),
    playerName: document.querySelector("#player-name"),
    saveButton: document.querySelector("#save-button"),
    saveMessage: document.querySelector("#save-message"),
    leaderboard: document.querySelector("#leaderboard-list"),
    modeButtons: [...document.querySelectorAll(".mode-button")],
    multiplayerLobby: document.querySelector("#multiplayer-lobby"),
    lobbyStatus: document.querySelector("#lobby-status"),
    roomPlayerName: document.querySelector("#room-player-name"),
    roomCodeInput: document.querySelector("#room-code-input"),
    createRoomButton: document.querySelector("#create-room-button"),
    joinRoomButton: document.querySelector("#join-room-button"),
    roomInvite: document.querySelector("#room-invite"),
    roomCodeDisplay: document.querySelector("#room-code-display"),
    roomPlayers: document.querySelector("#room-players"),
    notification: document.querySelector("#notification"),
    opponentPanel: document.querySelector("#opponent-panel"),
    opponentName: document.querySelector("#opponent-name"),
    opponentStatus: document.querySelector("#opponent-status"),
    opponentWpm: document.querySelector("#opponent-wpm"),
    opponentProgress: document.querySelector("#opponent-progress")
  };

  function getApiUrl() {
    return (window.TYPORA_CONFIG?.apiUrl || "").replace(/\/+$/, "");
  }

  function updateModeUI() {
    elements.modeButtons.forEach((button) => {
      const selected = button.dataset.mode === state.mode;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    elements.multiplayerLobby.hidden = state.mode !== "multiplayer";
    elements.opponentPanel.hidden = state.mode === "solo"
      || (state.mode === "multiplayer" && !state.roomCode);
    if (state.mode === "bot") {
      elements.opponentName.textContent = "Typora bot";
      elements.opponentStatus.textContent = "READY TO RACE";
    }
    if (state.mode === "multiplayer" && state.roomCode) {
      elements.opponentName.textContent = state.roomPlayers.find((player) => player.id !== state.socket?.id)?.name || "Opponent";
      elements.opponentStatus.textContent = state.roomReady ? "CONNECTED" : "WAITING FOR PLAYER";
    }
  }

  function setLobbyStatus(message, isError = false) {
    elements.lobbyStatus.textContent = message;
    elements.lobbyStatus.classList.toggle("is-error", isError);
  }

  function showNotification(message) {
    elements.notification.textContent = message;
    elements.notification.hidden = false;
    window.clearTimeout(state.notificationTimeoutId);
    state.notificationTimeoutId = window.setTimeout(() => {
      elements.notification.hidden = true;
    }, 4000);
  }

  function prepareRoomRound(room) {
    window.clearInterval(state.intervalId);
    state.intervalId = null;
    state.startedAt = null;
    state.isFinished = false;
    state.finalResult = null;
    state.scoreSavedFor = null;
    state.duration = room.duration;
    state.passage = room.passage;
    state.roomRound = room.round;
    state.roomStarted = false;
    state.roomReady = room.players.length === 2;
    elements.input.value = "";
    elements.input.disabled = !state.roomReady;
    elements.durationButtons.forEach((button) => {
      button.disabled = true;
      button.classList.toggle("is-selected", Number(button.dataset.duration) === state.duration);
    });
    elements.time.innerHTML = `${state.duration}<span class="unit">s</span>`;
    elements.wpm.textContent = "0";
    elements.accuracy.innerHTML = '100<span class="unit">%</span>';
    elements.characterCount.textContent = `0 / ${state.passage.length}`;
    elements.status.textContent = state.roomReady ? "READY TO RACE" : "WAITING FOR OPPONENT";
    elements.startPrompt.classList.toggle("is-hidden", !state.roomReady);
    elements.resultCard.hidden = true;
    elements.saveMessage.textContent = "";
    elements.saveMessage.classList.remove("is-error");
    renderPassage();
    updateModeUI();
  }

  function handleRoomUpdate(room) {
    if (state.mode !== "multiplayer") return;
    const hadOpponent = state.roomPlayers.some((player) => player.id !== state.socket?.id);
    const opponent = room.players.find((player) => player.id !== state.socket?.id);
    state.roomCode = room.code;
    state.roomPlayers = room.players;
    if (opponent && !hadOpponent) showNotification(`${opponent.name} is here!`);
    elements.roomInvite.hidden = false;
    elements.roomCodeDisplay.textContent = room.code;
    elements.roomPlayers.textContent = room.players.length === 2
      ? `${room.players.map((player) => player.name).join(" vs ")} · ready`
      : `${room.players[0]?.name || "Player"} · waiting for an opponent`;
    if (state.roomRound !== room.round || state.passage !== room.passage || state.duration !== room.duration) {
      prepareRoomRound(room);
    } else {
      state.roomReady = room.players.length === 2;
      elements.input.disabled = !state.roomReady || state.isFinished;
      elements.startPrompt.classList.toggle("is-hidden", !state.roomReady || state.startedAt !== null);
      elements.status.textContent = state.roomReady
        ? (state.startedAt === null ? "READY TO RACE" : "TEST IN PROGRESS")
        : "WAITING FOR OPPONENT";
    }
    setLobbyStatus(state.roomReady ? "Opponent connected. Start typing to begin." : "Share the room code with a friend.");
    updateModeUI();
  }

  function handleRoomResults(payload) {
    const mine = payload.players.find((player) => player.id === state.socket?.id);
    const opponent = payload.players.find((player) => player.id !== state.socket?.id);
    if (!mine || !opponent) return;
    elements.opponentName.textContent = opponent.name;
    elements.opponentStatus.textContent = "RACE COMPLETE";
    elements.opponentWpm.textContent = String(opponent.wpm);
    const progress = Math.min(100, Math.round((opponent.characters / state.passage.length) * 100));
    elements.opponentProgress.style.width = `${progress}%`;
    if (mine.wpm > opponent.wpm) {
      elements.resultTitle.textContent = "You won the race!";
      elements.resultMessage.textContent = `${opponent.name} finished at ${opponent.wpm} WPM.`;
    } else if (mine.wpm < opponent.wpm) {
      elements.resultTitle.textContent = "Good race!";
      elements.resultMessage.textContent = `${opponent.name} finished at ${opponent.wpm} WPM. Try a rematch.`;
    } else {
      elements.resultTitle.textContent = "It's a tie!";
      elements.resultMessage.textContent = `You both typed at ${mine.wpm} WPM.`;
    }
    setLobbyStatus("Race complete. Choose a new duration or restart for a rematch.");
  }

  function connectSocket() {
    const apiUrl = getApiUrl();
    if (!apiUrl) {
      setLobbyStatus("Set the Render API URL in config.js to enable multiplayer.", true);
      return Promise.reject(new Error("Multiplayer requires a Render API URL."));
    }
    if (state.socket?.connected) return Promise.resolve(state.socket);
    if (state.socketLoadPromise) return state.socketLoadPromise;

    state.socketLoadPromise = new Promise((resolve, reject) => {
      const startConnection = () => {
        state.socket = window.io(apiUrl);
        state.socket.on("connect", () => {
          setLobbyStatus("Connected. Create a room or join with a code.");
          resolve(state.socket);
        });
        state.socket.on("connect_error", (error) => {
          console.error("Could not connect to the multiplayer server.", error);
          setLobbyStatus("Could not connect. Check the Render URL and try again.", true);
          reject(error);
        });
        state.socket.on("disconnect", () => {
          if (state.mode === "multiplayer" && state.roomCode) {
            state.roomCode = null;
            state.roomReady = false;
            elements.roomInvite.hidden = true;
            resetGame();
          }
          if (state.mode === "multiplayer") setLobbyStatus("Connection lost. Refresh to reconnect.", true);
        });
        state.socket.on("room:update", handleRoomUpdate);
        state.socket.on("game:start", () => {
          state.roomStarted = true;
          if (state.startedAt === null) startTimer(false);
          elements.status.textContent = "TEST IN PROGRESS";
          elements.input.focus();
        });
        state.socket.on("room:progress", (progress) => {
          elements.opponentWpm.textContent = String(progress.wpm);
          elements.opponentStatus.textContent = "RACING";
          elements.opponentProgress.style.width = `${Math.min(100, Math.round((progress.characters / state.passage.length) * 100))}%`;
        });
        state.socket.on("room:results", handleRoomResults);
        state.socket.on("room:opponent-left", () => {
          state.roomCode = null;
          state.roomReady = false;
          state.roomStarted = false;
          state.roomPlayers = [];
          elements.roomInvite.hidden = true;
          if (state.mode === "multiplayer") {
            setLobbyStatus("Your opponent left the room. Create or join another room.", true);
            resetGame();
          }
        });
        state.socket.on("room:error", (message) => setLobbyStatus(message, true));
      };

      const existingScript = document.querySelector("#socket-io-client");
      if (window.io) {
        startConnection();
      } else if (existingScript) {
        existingScript.addEventListener("load", startConnection, { once: true });
        existingScript.addEventListener("error", () => {
          existingScript.remove();
          reject(new Error("Could not load the multiplayer client."));
        }, { once: true });
      } else {
        const script = document.createElement("script");
        script.id = "socket-io-client";
        script.src = `${apiUrl}/socket.io/socket.io.js`;
        script.onload = startConnection;
        script.onerror = () => {
          const error = new Error("Could not load the multiplayer client from Render.");
          script.remove();
          setLobbyStatus(error.message, true);
          reject(error);
        };
        document.head.append(script);
      }
    }).finally(() => {
      state.socketLoadPromise = null;
    });
    return state.socketLoadPromise;
  }

  function leaveRoom() {
    if (state.socket?.connected && state.roomCode) state.socket.emit("room:leave");
    state.roomCode = null;
    state.roomReady = false;
    state.roomStarted = false;
    state.roomRound = null;
    state.roomPlayers = [];
    elements.roomInvite.hidden = true;
  }

  async function createRoom() {
    const name = elements.roomPlayerName.value.trim();
    if (!name) {
      setLobbyStatus("Enter your name before creating a room.", true);
      elements.roomPlayerName.focus();
      return;
    }
    try {
      const socket = await connectSocket();
      socket.emit("room:create", { name, duration: state.duration, passage: state.passage }, (result) => {
        if (!result?.ok) setLobbyStatus(result?.error || "Could not create a room.", true);
      });
      state.playerName = name;
      setLobbyStatus("Creating your room…");
    } catch (error) {
      console.error("Could not create a multiplayer room.", error);
    }
  }

  async function joinRoom() {
    const name = elements.roomPlayerName.value.trim();
    const code = elements.roomCodeInput.value.trim().toUpperCase();
    if (!name || !code) {
      setLobbyStatus("Enter your name and a room code to join.", true);
      return;
    }
    try {
      const socket = await connectSocket();
      socket.emit("room:join", { name, code }, (result) => {
        if (!result?.ok) setLobbyStatus(result?.error || "Could not join that room.", true);
      });
      state.playerName = name;
      setLobbyStatus("Joining room…");
    } catch (error) {
      console.error("Could not join a multiplayer room.", error);
    }
  }

  function getBest() {
    try {
      const saved = localStorage.getItem(BEST_KEY) || localStorage.getItem(LEGACY_BEST_KEY);
      if (!saved) return 0;
      const parsed = Number(JSON.parse(saved).wpm);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    } catch (error) {
      console.warn("Could not read the saved personal best.", error);
      return 0;
    }
  }

  function getSavedScoreName() {
    try {
      return localStorage.getItem(SCORE_NAME_KEY) || "";
    } catch (error) {
      console.warn("Could not read the saved leaderboard name.", error);
      return "";
    }
  }

  function updateBestDisplay() {
    const best = getBest();
    elements.best.innerHTML = `${best || "—"}<span class="unit">wpm</span>`;
  }

  function choosePassage() {
    let index = Math.floor(Math.random() * passages.length);
    if (passages.length > 1 && index === state.lastPassageIndex) {
      index = (index + 1 + Math.floor(Math.random() * (passages.length - 1))) % passages.length;
    }
    state.lastPassageIndex = index;
    return passages[index];
  }

  function renderPassage(typedText = "") {
    const fragment = document.createDocumentFragment();
    [...state.passage].forEach((character, index) => {
      const span = document.createElement("span");
      span.textContent = character;
      if (index < typedText.length) {
        span.className = typedText[index] === character ? "correct" : "incorrect";
      } else if (index === typedText.length && !state.isFinished) {
        span.className = "current";
      }
      fragment.append(span);
    });
    elements.passage.replaceChildren(fragment);
  }

  function resetGame(focusInput = false) {
    window.clearInterval(state.intervalId);
    state.intervalId = null;
    state.startedAt = null;
    state.isFinished = false;
    state.finalResult = null;
    state.scoreSavedFor = null;
    state.roomStarted = false;
    state.botWpm = 0;
    state.passage = choosePassage();
    elements.input.value = "";
    elements.input.disabled = state.mode === "multiplayer";
    elements.durationButtons.forEach((button) => {
      button.disabled = state.mode === "multiplayer" && Boolean(state.roomCode);
      button.classList.toggle("is-selected", Number(button.dataset.duration) === state.duration);
    });
    elements.time.innerHTML = `${state.duration}<span class="unit">s</span>`;
    elements.wpm.textContent = "0";
    elements.accuracy.innerHTML = '100<span class="unit">%</span>';
    elements.characterCount.textContent = `0 / ${state.passage.length}`;
    elements.status.textContent = "READY WHEN YOU ARE";
    elements.startPrompt.classList.toggle("is-hidden", state.mode === "multiplayer" && !state.roomReady);
    elements.opponentWpm.textContent = "0";
    elements.opponentProgress.style.width = "0%";
    elements.opponentStatus.textContent = state.mode === "bot" ? "READY TO RACE" : "WAITING";
    elements.resultCard.hidden = true;
    elements.saveMessage.textContent = "";
    elements.saveMessage.classList.remove("is-error");
    renderPassage();
    updateBestDisplay();
    updateModeUI();
    if (focusInput) elements.input.focus();
  }

  function getMetrics(typedText, elapsedSeconds) {
    let correct = 0;
    for (let index = 0; index < typedText.length; index += 1) {
      if (typedText[index] === state.passage[index]) correct += 1;
    }
    const accuracy = typedText.length ? Math.round((correct / typedText.length) * 100) : 100;
    const elapsedMinutes = Math.max(elapsedSeconds, 1) / 60;
    const wpm = Math.min(300, Math.round((correct / 5) / elapsedMinutes));
    return { correct, accuracy, wpm };
  }

  function startTimer(broadcastToOpponent = true) {
    if (state.startedAt !== null || state.isFinished) return;
    if (state.mode === "multiplayer" && !state.roomReady) return;
    state.startedAt = Date.now();
    elements.status.textContent = "TEST IN PROGRESS";
    elements.startPrompt.classList.add("is-hidden");
    elements.durationButtons.forEach((button) => { button.disabled = true; });
    if (state.mode === "bot") {
      state.botWpm = [48, 62, 78, 92][Math.floor(Math.random() * 4)];
      elements.opponentName.textContent = "Typora bot";
      elements.opponentStatus.textContent = `${state.botWpm} WPM BOT`;
    }
    if (state.mode === "multiplayer" && broadcastToOpponent) {
      state.socket?.emit("game:begin");
    }
    state.intervalId = window.setInterval(updateLiveStats, 100);
  }

  function updateBot(elapsedSeconds) {
    const characters = Math.min(state.passage.length, Math.floor((state.botWpm * 5 * elapsedSeconds) / 60));
    const botProgress = (characters / state.passage.length) * 100;
    elements.opponentWpm.textContent = String(Math.round(state.botWpm * Math.min(elapsedSeconds / 2, 1)));
    elements.opponentProgress.style.width = `${botProgress}%`;
    elements.opponentStatus.textContent = characters >= state.passage.length ? "FINISHED" : "RACING";
    return characters;
  }

  function updateLiveStats() {
    if (state.startedAt === null || state.isFinished) return;
    const elapsedSeconds = (Date.now() - state.startedAt) / 1000;
    const remaining = Math.max(0, Math.ceil(state.duration - elapsedSeconds));
    const metrics = getMetrics(elements.input.value, elapsedSeconds);
    elements.time.innerHTML = `${remaining}<span class="unit">s</span>`;
    elements.wpm.textContent = String(metrics.wpm);
    elements.accuracy.innerHTML = `${metrics.accuracy}<span class="unit">%</span>`;
    elements.characterCount.textContent = `${elements.input.value.length} / ${state.passage.length}`;
    if (state.mode === "bot") updateBot(elapsedSeconds);
    if (state.mode === "multiplayer" && state.socket?.connected && Date.now() - state.lastProgressAt >= 400) {
      state.lastProgressAt = Date.now();
      state.socket.emit("room:progress", {
        wpm: metrics.wpm,
        accuracy: metrics.accuracy,
        characters: elements.input.value.length
      });
    }
    if (remaining <= 0) finishGame();
  }

  function finishGame() {
    if (state.isFinished) return;
    const elapsedSeconds = state.startedAt === null
      ? state.duration
      : Math.min(state.duration, (Date.now() - state.startedAt) / 1000);
    const metrics = getMetrics(elements.input.value, elapsedSeconds);
    state.isFinished = true;
    state.finalResult = { ...metrics, duration: state.duration };
    window.clearInterval(state.intervalId);
    state.intervalId = null;
    elements.input.disabled = true;
    elements.status.textContent = "TEST COMPLETE";
    elements.time.innerHTML = '0<span class="unit">s</span>';
    elements.wpm.textContent = String(metrics.wpm);
    elements.accuracy.innerHTML = `${metrics.accuracy}<span class="unit">%</span>`;
    elements.resultWpm.textContent = String(metrics.wpm);
    elements.resultAccuracy.textContent = `${metrics.accuracy}%`;

    let isNewBest = false;
    const previousBest = getBest();
    if (metrics.wpm > previousBest) {
      try {
        localStorage.setItem(BEST_KEY, JSON.stringify({ wpm: metrics.wpm, date: new Date().toISOString() }));
        isNewBest = true;
        elements.resultMessage.textContent = "A new high score. Keep that momentum going.";
      } catch (error) {
        console.warn("Could not save the personal best on this device.", error);
        elements.resultTitle.textContent = "Nice work.";
        elements.resultMessage.textContent = "Keep practicing to beat your best.";
      }
    } else {
      elements.resultTitle.textContent = "Nice work.";
      elements.resultMessage.textContent = "Keep practicing to beat your best.";
    }
    if (state.mode === "bot") {
      const botCharacters = Math.min(
        state.passage.length,
        Math.floor((state.botWpm * 5 * elapsedSeconds) / 60)
      );
      elements.opponentWpm.textContent = String(state.botWpm);
      elements.opponentProgress.style.width = `${(botCharacters / state.passage.length) * 100}%`;
      elements.opponentStatus.textContent = "RACE COMPLETE";
      elements.resultTitle.textContent = metrics.wpm > state.botWpm
        ? "You beat the bot!"
        : (metrics.wpm === state.botWpm ? "It's a tie!" : "The bot wins this one.");
      elements.resultMessage.textContent = `${isNewBest ? "New personal best! " : ""}Bot speed: ${state.botWpm} WPM.`;
    } else if (state.mode === "multiplayer" && state.socket?.connected) {
      elements.resultTitle.textContent = "Race finished!";
      elements.resultMessage.textContent = "Waiting for your opponent to finish…";
      state.socket.emit("room:result", {
        wpm: metrics.wpm,
        accuracy: metrics.accuracy,
        characters: elements.input.value.length
      });
    } else if (isNewBest) {
      elements.resultTitle.textContent = "New personal best!";
    } else {
      elements.resultTitle.textContent = "Nice work.";
    }
    updateBestDisplay();
    elements.resultCard.hidden = false;
    elements.resultCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
    const scoreName = state.mode === "multiplayer"
      ? state.playerName.trim()
      : elements.playerName.value.trim();
    if (scoreName) {
      elements.playerName.value = scoreName;
      void saveScore();
    } else {
      elements.saveMessage.textContent = "Enter your name to save this score automatically.";
    }
  }

  function makeLeaderboardRow(score, index) {
    const row = document.createElement("li");
    row.className = "leaderboard-row";
    const rank = document.createElement("span");
    rank.className = "leaderboard-rank";
    rank.textContent = String(index + 1).padStart(2, "0");
    const name = document.createElement("span");
    name.className = "leaderboard-name";
    name.textContent = score.name;
    const accuracy = document.createElement("span");
    accuracy.className = "leaderboard-accuracy";
    accuracy.textContent = `${score.accuracy}%`;
    const wpm = document.createElement("span");
    wpm.className = "leaderboard-wpm";
    wpm.textContent = String(score.wpm);
    row.append(rank, name, accuracy, wpm);
    return row;
  }

  async function loadLeaderboard() {
    const apiUrl = getApiUrl();
    if (!apiUrl) return;
    try {
      const response = await fetch(`${apiUrl}/api/leaderboard`);
      if (!response.ok) throw new Error(`Leaderboard request failed (${response.status}).`);
      const scores = await response.json();
      if (!Array.isArray(scores)) throw new Error("Leaderboard returned an invalid response.");
      if (!scores.length) {
        elements.leaderboard.innerHTML = '<li class="leaderboard-empty">No scores yet. Be the first to set one.</li>';
        return;
      }
      elements.leaderboard.replaceChildren(...scores.slice(0, 10).map(makeLeaderboardRow));
    } catch (error) {
      console.error("Could not load the leaderboard.", error);
      elements.leaderboard.innerHTML = '<li class="leaderboard-empty">Leaderboard is temporarily unavailable.</li>';
    }
  }

  async function saveScore() {
    const result = state.finalResult;
    if (!result || state.scoreSavedFor === result || state.scoreSavingFor === result) return;
    const apiUrl = getApiUrl();
    if (!apiUrl) {
      elements.saveMessage.textContent = "Leaderboard is not configured yet. Your personal best is saved on this device.";
      return;
    }
    const name = elements.playerName.value.trim() || state.playerName.trim();
    if (!name) {
      elements.saveMessage.textContent = "Enter your name to save this score automatically.";
      return;
    }
    if (!/^[\p{L}\p{N} _.-]{2,20}$/u.test(name)) {
      elements.saveMessage.textContent = "Use 2–20 letters, numbers, spaces, dots, or dashes for your name.";
      elements.saveMessage.classList.add("is-error");
      return;
    }

    state.scoreSavingFor = result;
    elements.saveButton.disabled = true;
    elements.saveMessage.textContent = "Saving your score…";
    elements.saveMessage.classList.remove("is-error");
    try {
      const response = await fetch(`${apiUrl}/api/scores`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, ...result })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `Could not save score (${response.status}).`);
      state.scoreSavedFor = result;
      try {
        localStorage.setItem(SCORE_NAME_KEY, name);
      } catch (error) {
        console.warn("Could not remember the leaderboard name on this device.", error);
      }
      if (state.finalResult !== result) return;
      elements.saveMessage.textContent = "Score saved. Nice typing!";
      elements.playerName.value = name;
      await loadLeaderboard();
    } catch (error) {
      console.error("Could not save the score.", error);
      if (state.finalResult === result) {
        elements.saveMessage.textContent = error.message || "Could not save your score. Try again.";
        elements.saveMessage.classList.add("is-error");
      }
    } finally {
      if (state.scoreSavingFor === result) state.scoreSavingFor = null;
      if (state.finalResult === result) elements.saveButton.disabled = false;
    }
  }

  elements.input.addEventListener("input", () => {
    if (state.isFinished) return;
    if (elements.input.value.length > state.passage.length) {
      elements.input.value = elements.input.value.slice(0, state.passage.length);
    }
    if (elements.input.value.length > 0) startTimer();
    renderPassage(elements.input.value);
    elements.characterCount.textContent = `${elements.input.value.length} / ${state.passage.length}`;
    if (elements.input.value.length === state.passage.length) finishGame();
  });

  elements.input.addEventListener("paste", (event) => event.preventDefault());
  elements.startPrompt.addEventListener("click", () => elements.input.focus());
  elements.passageArea.addEventListener("click", () => elements.input.focus());
  function restartTest() {
    if (state.mode === "multiplayer" && state.roomCode && state.socket?.connected) {
      state.socket.emit("room:rematch", { passage: choosePassage() });
      setLobbyStatus("Preparing a rematch…");
      return;
    }
    resetGame(true);
  }

  elements.restartButton.addEventListener("click", restartTest);
  elements.modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const nextMode = button.dataset.mode;
      if (nextMode === state.mode) return;
      if (state.mode === "multiplayer") leaveRoom();
      state.mode = nextMode;
      state.roomReady = false;
      state.playerName = "";
      resetGame();
      if (state.mode === "multiplayer") {
        setLobbyStatus("Connecting to the game server…");
        connectSocket().catch((error) => console.error("Multiplayer connection failed.", error));
      }
    });
  });
  elements.durationButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (state.mode === "multiplayer" && state.roomCode) return;
      state.duration = Number(button.dataset.duration);
      resetGame();
      elements.input.focus();
    });
  });
  elements.createRoomButton.addEventListener("click", createRoom);
  elements.joinRoomButton.addEventListener("click", joinRoom);
  elements.roomCodeInput.addEventListener("input", () => {
    elements.roomCodeInput.value = elements.roomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  });
  elements.saveButton.addEventListener("click", saveScore);
  elements.playerName.addEventListener("change", () => {
    if (state.finalResult) void saveScore();
  });
  elements.playerName.addEventListener("keydown", (event) => {
    if (event.key === "Enter") saveScore();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !(event.target instanceof HTMLInputElement)) restartTest();
    if ((event.key === "Enter" || event.key === " ") && event.target === elements.startPrompt) {
      event.preventDefault();
      elements.input.focus();
    }
    if (event.key.length === 1 && event.target !== elements.input && !(event.target instanceof HTMLInputElement)) {
      elements.input.focus();
    }
  });

  elements.playerName.value = getSavedScoreName();
  resetGame();
  loadLeaderboard();
})();
