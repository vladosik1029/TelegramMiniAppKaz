// ─── WebSocket-канал столов ──────────────────────────────────────────────────
// Подключение: wss://<host>/ws?t=<initData> (в DEV_MODE: пусто = dev-игрок,
// либо «dev:<id>» — мок-игрок для тестов с двумя клиентами).
// Клиент → сервер: { op: 'sub'|'bet'|'clear'|'spin'|'leave'|'refresh', roomId?, ...; rid? }
// Сервер → клиент: { type: 'room', room } — персональное состояние стола после
// каждого изменения; { type: 'left', roomId, cashout, balance }; { type: 'closed', roomId };
// { type: 'error', error, rid }; { type: 'ok', rid }.

import { WebSocketServer } from 'ws';
import { userFromInitData, ensureUser, errorText } from './routes.js';
import {
  getRoom, roomState, placeBet, clearBets, spinRoulette, leaveRoom,
  socketAttached, socketDetached, onRoomChange,
} from './rooms.js';

const HEARTBEAT_MS = 30_000;

export function attachWs(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/ws') return socket.destroy();
    const user = userFromInitData(url.searchParams.get('t') || '');
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      return socket.destroy();
    }
    ensureUser(user);
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.user = user;
      ws.roomId = null;
      ws.alive = true;
      wss.emit('connection', ws);
    });
  });

  const send = (ws, msg) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); };

  const unsub = (ws) => {
    if (ws.roomId) socketDetached(ws.roomId, ws.user.id);
    ws.roomId = null;
  };

  // каждое изменение стола — персональное состояние всем, кто на него подписан
  onRoomChange((room, event) => {
    for (const ws of wss.clients) {
      if (ws.roomId !== room.id) continue;
      if (event === 'closed') { ws.roomId = null; send(ws, { type: 'closed', roomId: room.id }); continue; }
      if (!room.members.has(ws.user.id)) {
        // игрок вышел с другого устройства / через REST
        ws.roomId = null;
        send(ws, { type: 'left', roomId: room.id });
        continue;
      }
      send(ws, { type: 'room', event, room: roomState(room, ws.user.id) });
    }
  });

  wss.on('connection', (ws) => {
    ws.on('pong', () => { ws.alive = true; });
    ws.on('close', () => unsub(ws));

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      const rid = msg?.rid ?? null;
      const uid = ws.user.id;
      try {
        switch (msg?.op) {
          case 'sub': {
            const room = getRoom(msg.roomId);
            if (!room) throw new Error('ROOM_NOT_FOUND');
            if (!room.members.has(uid)) throw new Error('NOT_IN_ROOM');
            if (ws.roomId !== room.id) { unsub(ws); ws.roomId = room.id; socketAttached(room.id, uid); }
            send(ws, { type: 'room', event: 'sub', room: roomState(room, uid) });
            break;
          }
          case 'refresh': {
            const room = ws.roomId && getRoom(ws.roomId);
            if (room) send(ws, { type: 'room', event: 'refresh', room: roomState(room, uid) });
            break;
          }
          case 'bet': placeBet(uid, ws.roomId, msg); break;
          case 'clear': clearBets(uid, ws.roomId); break;
          case 'spin': spinRoulette(uid, ws.roomId); break;
          case 'leave': {
            const roomId = ws.roomId;
            unsub(ws);
            const r = leaveRoom(uid, roomId);
            send(ws, { type: 'left', roomId, ...r });
            break;
          }
          default: throw new Error('BAD_ACTION');
        }
        if (rid != null) send(ws, { type: 'ok', rid });
      } catch (e) {
        const text = errorText(e);
        if (!text) console.error('ws error', e);
        send(ws, { type: 'error', rid, error: text || 'Внутренняя ошибка сервера' });
      }
    });
  });

  // heartbeat: рвём «мёртвые» соединения (мобильные клиенты часто пропадают молча)
  const timer = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) { ws.terminate(); continue; }
      ws.alive = false;
      try { ws.ping(); } catch {}
    }
  }, HEARTBEAT_MS);
  wss.on('close', () => clearInterval(timer));

  return wss;
}
