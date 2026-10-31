
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static("public"));

const rooms = new Map();
const WIDTH = 800;
const HEIGHT = 500;

const COLORS = [
  "#ff6b6b", "#4ecdc4", "#ffe66d",
  "#a78bfa", "#fb923c", "#f472b6",
  "#60a5fa", "#a3e635"
];

function randomPosition() {
  return {
    x: 30 + Math.random() * 740,
    y: 30 + Math.random() * 440
  };
}

function createStar() {
  return {
    ...randomPosition(),
    gold: Math.random() < 0.2
  };
}

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcast(room) {
  const data = JSON.stringify({
    type: "state",
    code: room.code,
    host: room.host,
    status: room.status,
    remaining: room.remaining,
    players: [...room.players.values()].map(p => ({
      id: p.id,
      name: p.name,
      x: p.x,
      y: p.y,
      score: p.score,
      color: p.color
    })),
    stars: room.stars
  });

  for (const p of room.players.values()) {
    if (p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(data);
    }
  }
}

function makeCode() {
  let code;
  do {
    code = crypto.randomBytes(4)
      .toString("hex")
      .slice(0, 6)
      .toUpperCase();
  } while (rooms.has(code));
  return code;
}

wss.on("connection", ws => {
  const id = crypto.randomUUID();
  let currentRoom = null;

  ws.on("message", raw => {
    let msg;

    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === "create" || msg.type === "join") {
      if (currentRoom) return;

      let room;

      if (msg.type === "create") {
        const code = makeCode();

        room = {
          code,
          host: id,
          status: "lobby",
          remaining: 180,
          players: new Map(),
          stars: [],
          lastTick: Date.now()
        };

        rooms.set(code, room);
      } else {
        room = rooms.get(
          String(msg.code || "").trim().toUpperCase()
        );

        if (
          !room ||
          room.status !== "lobby" ||
          room.players.size >= 8
        ) {
          return send(ws, {
            type: "error",
            message: "Room unavailable or full."
          });
        }
      }

      const pos = randomPosition();

      const name = String(msg.name || "Player")
        .trim()
        .slice(0, 16) || "Player";

      room.players.set(id, {
        id,
        ws,
        name,
        ...pos,
        score: 0,
        color: COLORS[room.players.size % COLORS.length],
        dx: 0,
        dy: 0
      });

      currentRoom = room;

      send(ws, {
        type: "joined",
        id,
        code: room.code
      });

      broadcast(room);
    }

    if (!currentRoom) return;

    const room = currentRoom;
    const player = room.players.get(id);

    if (!player) return;

    if (
      msg.type === "start" &&
      room.host === id &&
      room.players.size >= 2 &&
      room.status !== "playing"
    ) {
      room.status = "playing";
      room.remaining = 180;
      room.lastTick = Date.now();

      room.stars = Array.from(
        { length: 15 },
        createStar
      );

      for (const p of room.players.values()) {
        p.score = 0;
        Object.assign(p, randomPosition());
        p.dx = 0;
        p.dy = 0;
      }

      broadcast(room);
    }

    if (msg.type === "move") {
      const dx = Number(msg.dx);
      const dy = Number(msg.dy);

      if (
        !Number.isFinite(dx) ||
        !Number.isFinite(dy)
      ) return;

      player.dx = Math.max(-1, Math.min(1, dx));
      player.dy = Math.max(-1, Math.min(1, dy));
    }
  });

  ws.on("close", () => {
    if (!currentRoom) return;

    const room = currentRoom;
    room.players.delete(id);

    if (room.host === id) {
      room.host =
        room.players.keys().next().value || null;
    }

    if (!room.players.size) {
      rooms.delete(room.code);
    } else {
      broadcast(room);
    }
  });
});

setInterval(() => {
  const now = Date.now();

  for (const room of rooms.values()) {
    if (room.status !== "playing") continue;

    const dt = Math.min(
      (now - room.lastTick) / 1000,
      0.1
    );

    room.lastTick = now;

    room.remaining = Math.max(
      0,
      room.remaining - dt
    );

    for (const p of room.players.values()) {
      const length = Math.hypot(p.dx, p.dy) || 1;

      p.x = Math.max(
        15,
        Math.min(
          WIDTH - 15,
          p.x + p.dx / length * 220 * dt
        )
      );

      p.y = Math.max(
        15,
        Math.min(
          HEIGHT - 15,
          p.y + p.dy / length * 220 * dt
        )
      );

      for (let i = 0; i < room.stars.length; i++) {
        const star = room.stars[i];

        if (
          Math.hypot(
            p.x - star.x,
            p.y - star.y
          ) < 24
        ) {
          p.score += star.gold ? 5 : 1;
          room.stars[i] = createStar();
        }
      }
    }

    if (room.remaining <= 0) {
      room.status = "finished";

      for (const p of room.players.values()) {
        p.dx = 0;
        p.dy = 0;
      }
    }

    broadcast(room);
  }
}, 50);

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

server.listen(
  process.env.PORT || 3000,
  "0.0.0.0",
  () => {
    console.log("Cosmic Dash server running");
  }
);
