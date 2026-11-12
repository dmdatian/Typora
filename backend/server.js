"use strict";

const express = require("express");
const cors = require("cors");
const { cert, initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const http = require("node:http");
const { randomBytes } = require("node:crypto");
const { Server } = require("socket.io");

const port = Number(process.env.PORT) || 3000;
const allowedOrigins = new Set(
  (process.env.FRONTEND_ORIGIN || "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);
const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

if (!serviceAccountJson) {
  throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON must be set to the Firebase service-account JSON.");
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(serviceAccountJson);
} catch (error) {
  throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON must contain valid JSON.", { cause: error });
}

initializeApp({ credential: cert(serviceAccount) });
const database = getFirestore();
const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: [...allowedOrigins],
    methods: ["GET", "POST"]
  }
});
const rooms = new Map();
const roomAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

app.disable("x-powered-by");
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error("Origin is not allowed by CORS."));
  }
}));
app.use(express.json({ limit: "10kb" }));

app.get("/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.get("/api/leaderboard", async (_request, response, next) => {
  try {
    const snapshot = await database
      .collection("scores")
      .orderBy("wpm", "desc")
      .limit(10)
      .get();
    response.json(snapshot.docs.map((document) => {
      const score = document.data();
      return {
        name: score.name,
        wpm: score.wpm,
        accuracy: score.accuracy
      };
    }));
  } catch (error) {
    next(error);
  }
});

app.post("/api/scores", async (request, response, next) => {
  const { name, wpm, accuracy, duration } = request.body || {};
  const cleanName = typeof name === "string" ? name.trim() : "";
  const validName = /^[\p{L}\p{N} _.-]{2,20}$/u.test(cleanName);
  const validWpm = Number.isInteger(wpm) && wpm >= 1 && wpm <= 300;
  const validAccuracy = Number.isInteger(accuracy) && accuracy >= 0 && accuracy <= 100;
  const validDuration = [15, 30, 60].includes(duration);

  if (!validName || !validWpm || !validAccuracy || !validDuration) {
    return response.status(400).json({
      error: "Provide a 2–20 character name, WPM from 1–300, accuracy from 0–100, and a valid test duration."
    });
  }

  try {
    await database.collection("scores").add({
      name: cleanName,
      wpm,
      accuracy,
      duration,
      createdAt: FieldValue.serverTimestamp()
    });
    return response.status(201).json({ saved: true });
  } catch (error) {
    return next(error);
  }
});

app.use((error, _request, response, _next) => {
  console.error("API request failed.", error);
  if (response.headersSent) return;
  const status = error.status === 413 ? 413 : 500;
  return response.status(status).json({
    error: status === 413 ? "Request body is too large." : "The server could not complete the request."
  });
});

function makeRoomCode() {
  let code;
  do {
    code = [...randomBytes(6)].map((byte) => roomAlphabet[byte % roomAlphabet.length]).join("");
  } while (rooms.has(code));
  return code;
}

function validPlayerName(name) {
  return typeof name === "string" && /^[\p{L}\p{N} _.-]{2,20}$/u.test(name.trim());
}

function validPassage(passage) {
  return typeof passage === "string" && passage.length >= 20 && passage.length <= 500;
}

function roomSummary(room) {
  return {
    code: room.code,
    duration: room.duration,
    passage: room.passage,
    round: room.round,
    started: room.started,
    players: [...room.players.entries()].map(([id, player]) => ({ id, name: player.name }))
  };
}

function publishRoom(room) {
  io.to(room.code).emit("room:update", roomSummary(room));
}

function finishRoom(room) {
  if (room.timeout) clearTimeout(room.timeout);
  room.timeout = null;
  const players = [...room.players.entries()].map(([id, player]) => {
    const result = room.results.get(id) || { wpm: 0, accuracy: 0, characters: 0 };
    return { id, name: player.name, ...result };
  });
  io.to(room.code).emit("room:results", { players });
}

function leaveRoom(socket) {
  const code = socket.data.roomCode;
  if (!code) return;
  const room = rooms.get(code);
  socket.data.roomCode = null;
  if (!room) return;
  if (room.timeout) clearTimeout(room.timeout);
  rooms.delete(code);
  io.to(code).emit("room:opponent-left");
}

function roomAck(callback, result) {
  if (typeof callback === "function") callback(result);
}

io.on("connection", (socket) => {
  socket.on("room:create", (payload, callback) => {
    const { name, duration, passage } = payload || {};
    if (socket.data.roomCode) {
      return roomAck(callback, { ok: false, error: "Leave your current room before creating another." });
    }
    if (!validPlayerName(name) || ![15, 30, 60].includes(duration) || !validPassage(passage)) {
      return roomAck(callback, { ok: false, error: "Enter a valid name and choose a test duration." });
    }
    const code = makeRoomCode();
    const room = {
      code,
      duration,
      passage,
      round: 1,
      players: new Map([[socket.id, { name: name.trim() }]]),
      results: new Map(),
      started: false,
      timeout: null
    };
    rooms.set(code, room);
    socket.data.roomCode = code;
    socket.join(code);
    publishRoom(room);
    return roomAck(callback, { ok: true, code });
  });

  socket.on("room:join", (payload, callback) => {
    const { name, code } = payload || {};
    const normalizedCode = typeof code === "string" ? code.trim().toUpperCase() : "";
    const room = rooms.get(normalizedCode);
    if (socket.data.roomCode) {
      return roomAck(callback, { ok: false, error: "Leave your current room before joining another." });
    }
    if (!validPlayerName(name)) {
      return roomAck(callback, { ok: false, error: "Enter a valid name (2–20 letters, numbers, spaces, dots, or dashes)." });
    }
    if (!room || !/^[A-Z0-9]{6}$/.test(normalizedCode)) {
      return roomAck(callback, { ok: false, error: "That room code was not found." });
    }
    if (room.started || room.players.size >= 2) {
      return roomAck(callback, { ok: false, error: "That room is already in a race." });
    }
    room.players.set(socket.id, { name: name.trim() });
    socket.data.roomCode = normalizedCode;
    socket.join(normalizedCode);
    publishRoom(room);
    return roomAck(callback, { ok: true, code: normalizedCode });
  });

  socket.on("game:begin", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.players.size !== 2 || room.started) return;
    room.started = true;
    io.to(room.code).emit("game:start");
    room.timeout = setTimeout(() => finishRoom(room), room.duration * 1000 + 5000);
  });

  socket.on("room:progress", (payload) => {
    const { wpm, accuracy, characters } = payload || {};
    const room = rooms.get(socket.data.roomCode);
    if (!room?.started) return;
    const player = room.players.get(socket.id);
    if (!player) return;
    const progress = {
      name: player.name,
      wpm: Number.isInteger(wpm) ? Math.min(300, Math.max(0, wpm)) : 0,
      accuracy: Number.isInteger(accuracy) ? Math.min(100, Math.max(0, accuracy)) : 0,
      characters: Number.isInteger(characters) ? Math.min(room.passage.length, Math.max(0, characters)) : 0
    };
    socket.to(room.code).emit("room:progress", progress);
  });

  socket.on("room:result", (payload) => {
    const { wpm, accuracy, characters } = payload || {};
    const room = rooms.get(socket.data.roomCode);
    if (!room?.started || !room.players.has(socket.id) || room.results.has(socket.id)) return;
    if (![wpm, accuracy, characters].every(Number.isInteger)) return;
    room.results.set(socket.id, {
      wpm: Math.min(300, Math.max(0, wpm)),
      accuracy: Math.min(100, Math.max(0, accuracy)),
      characters: Math.min(room.passage.length, Math.max(0, characters))
    });
    if (room.results.size === 2) finishRoom(room);
  });

  socket.on("room:rematch", (payload) => {
    const { passage } = payload || {};
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.players.size !== 2 || !validPassage(passage)) return;
    if (room.timeout) clearTimeout(room.timeout);
    room.timeout = null;
    room.round += 1;
    room.passage = passage;
    room.results.clear();
    room.started = false;
    publishRoom(room);
  });

  socket.on("room:leave", () => leaveRoom(socket));
  socket.on("disconnect", () => leaveRoom(socket));
});

httpServer.listen(port, "0.0.0.0", () => {
  console.log(`Typora API listening on port ${port}.`);
});
