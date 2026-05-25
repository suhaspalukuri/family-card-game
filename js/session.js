/**
 * session.js — Ably-powered session management for Rummy Royale
 *
 * Architecture:
 * - All game state is published/subscribed through Ably channels
 * - State is ALSO cached in localStorage for reconnection resilience
 * - One channel per session: "rummy:SESSION_ID"
 * - Messages: session-update | game-state | game-update | player-join
 *
 * ⚠️  REQUIRED:  Set your Ably API key below.
 *   1. Go to https://ably.com → sign up (free, no credit card)
 *   2. Create an app → copy the API Key from "API Keys" tab
 *   3. Paste it below replacing "YOUR_ABLY_API_KEY_HERE"
 *
 * Free tier limits: 6 million messages/month — more than enough for card games.
 */

// ─────────────────────────────────────────────────────────
// ⚙️  ABLY CONFIGURATION — Fill this in!
// ─────────────────────────────────────────────────────────
const ABLY_API_KEY = 'LpS2rg.ijyaYA:151bc2s-060Zs139OdgnqYbEHNCxMcVqPMt5-_KMvek';

// ─────────────────────────────────────────────────────────
// Ably SDK (loaded via CDN in HTML files)
// ─────────────────────────────────────────────────────────
let _ably = null;

function getAbly() {
  if (!_ably) {
    if (!window.Ably) {
      throw new Error('Ably SDK not loaded. Add <script src="https://cdn.ably.com/lib/ably.min-2.js"></script> before your module scripts.');
    }
    if (ABLY_API_KEY === 'YOUR_ABLY_API_KEY_HERE') {
      throw new Error('Please set your Ably API key in js/session.js');
    }
    _ably = new window.Ably.Realtime({
      key: ABLY_API_KEY,
      clientId: getOrCreateClientId(),
      echoMessages: false,
    });
  }
  return _ably;
}

function getOrCreateClientId() {
  let id = localStorage.getItem('rummy_client_id');
  if (!id) {
    id = 'client_' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem('rummy_client_id', id);
  }
  return id;
}

// ─────────────────────────────────────────────────────────
// ID / PIN Generation Helpers
// ─────────────────────────────────────────────────────────
const AVATARS = ['🦁','🐯','🦊','🐺','🐸','🦄','🐉','🦅','🐬','🦋','🐙','🦞'];
const ADJECTIVES = ['Swift','Bold','Brave','Lucky','Mighty','Clever','Wild','Calm'];
const NOUNS = ['Fox','Tiger','Eagle','Dragon','Wolf','Panda','Shark','Lynx'];

function generateSessionId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function generatePlayerId(slot) {
  const adj  = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj}${noun}${slot}`;
}

function generatePin() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

// ─────────────────────────────────────────────────────────
// LocalStorage Helpers
// ─────────────────────────────────────────────────────────
const STORAGE_SESSION_KEY = 'rummy_session';
const STORAGE_PLAYER_KEY  = 'rummy_player';
const HISTORY_KEY         = 'rummy_history';

function storeSession(session) {
  localStorage.setItem(STORAGE_SESSION_KEY, JSON.stringify(session));
}

function storePlayer(player) {
  localStorage.setItem(STORAGE_PLAYER_KEY, JSON.stringify(player));
}

export function getStoredSession() {
  try { return JSON.parse(localStorage.getItem(STORAGE_SESSION_KEY)); } catch { return null; }
}

export function getCurrentPlayer() {
  try { return JSON.parse(localStorage.getItem(STORAGE_PLAYER_KEY)); } catch { return null; }
}

export function getLocalHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch { return []; }
}

export function saveGameResult(sessionId, result) {
  const history = getLocalHistory();
  history.unshift({ sessionId, date: Date.now(), ...result });
  if (history.length > 50) history.pop();
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

// ─────────────────────────────────────────────────────────
// Channel name for a session
// ─────────────────────────────────────────────────────────
function channelName(sessionId) {
  return `rummy:${sessionId}`;
}

// ─────────────────────────────────────────────────────────
// In-memory session store (the host holds authoritative state)
// All clients maintain a local copy for rendering
// ─────────────────────────────────────────────────────────
const _sessions = {};   // sessionId → session object (full, stored by host)
const _gameStates = {}; // sessionId → gameState object

// ─────────────────────────────────────────────────────────
// createSession — Host only
// Creates 6 player slots with IDs and PINs, stores in localStorage
// and broadcasts the session to the channel
// ─────────────────────────────────────────────────────────
export async function createSession(playerConfigs, options = {}) {
  const sessionId  = generateSessionId();
  const minPlayers = options.minPlayers || 2;
  const players    = {};

  for (let i = 0; i < 6; i++) {
    const cfg   = playerConfigs[i] || {};
    const slot  = i + 1;
    const pid   = generatePlayerId(slot);
    const pin   = generatePin();
    const isHost = i === 0;

    players[pid] = {
      id:       pid,
      pin,
      name:     cfg.name || `Player ${slot}`,
      avatar:   AVATARS[i],
      slot,
      isHost,
      joined:   false,
      online:   false,
    };
  }

  const session = {
    id:          sessionId,
    players,
    minPlayers,
    status:      'waiting',
    createdAt:   Date.now(),
    gameState:   null,
    hostClientId: getOrCreateClientId(),
  };

  _sessions[sessionId] = session;
  storeSession(session);

  // Broadcast session creation on the Ably channel
  const ably    = getAbly();
  const channel = ably.channels.get(channelName(sessionId));

  await channel.publish('session-update', session);

  // Subscribe to player-join messages so the host can update state
  channel.subscribe('player-join', async (msg) => {
    const { playerId, name, avatar } = msg.data;
    const s = _sessions[sessionId];
    if (s && s.players[playerId]) {
      s.players[playerId].joined = true;
      s.players[playerId].online = true;
      if (name) s.players[playerId].name = name;
      storeSession(s);
      await channel.publish('session-update', s);
    }
  });

  channel.subscribe('player-online', (msg) => {
    const { playerId, online } = msg.data;
    const s = _sessions[sessionId];
    if (s && s.players[playerId]) {
      s.players[playerId].online = online;
      storeSession(s);
    }
  });

  return session;
}

// ─────────────────────────────────────────────────────────
// getSession — Get current session state
// ─────────────────────────────────────────────────────────
export async function getSession(sessionId) {
  // Return in-memory if available
  if (_sessions[sessionId]) return _sessions[sessionId];
  // Otherwise return stored
  const stored = getStoredSession();
  if (stored && stored.id === sessionId) return stored;
  return null;
}

// ─────────────────────────────────────────────────────────
// joinSession — Player (non-host) joins a session
// Validates ID + PIN, publishes a join event
// ─────────────────────────────────────────────────────────
export async function joinSession(sessionId, playerId, pin) {
  const ably    = getAbly();
  const channel = ably.channels.get(channelName(sessionId));

  // Request current session state via presence or by publishing a request
  return new Promise((resolve, reject) => {
    let resolved = false;

    // Listen for session-update (host will send after player-join)
    const unsub = channel.subscribe('session-update', (msg) => {
      const session = msg.data;
      if (!session || !session.players) return;

      const player = session.players[playerId];
      if (!player) {
        if (!resolved) { resolved = true; unsub(); reject(new Error('Player ID not found in this session.')); }
        return;
      }
      if (player.pin !== pin) {
        if (!resolved) { resolved = true; unsub(); reject(new Error('Incorrect PIN.')); }
        return;
      }

      // Auth success — store player locally
      const playerData = {
        sessionId,
        playerId,
        name:   player.name,
        avatar: player.avatar,
        isHost: player.isHost,
        slot:   player.slot,
      };
      storePlayer(playerData);
      _sessions[sessionId] = session;
      storeSession(session);

      if (!resolved) {
        resolved = true;
        resolve({ session, player: playerData });
      }
    });

    // Timeout after 10s
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        reject(new Error('Session not found or host is offline. Make sure the session ID is correct and the host has the lobby open.'));
      }
    }, 10000);

    // Publish join request (host's listener will respond with session-update)
    channel.publish('player-join', { playerId, pin, name: undefined, avatar: undefined })
      .catch(reject);
  });
}

// ─────────────────────────────────────────────────────────
// subscribeToSession — Listen for session updates (lobby)
// Returns unsubscribe function
// ─────────────────────────────────────────────────────────
export function subscribeToSession(sessionId, callback) {
  const ably    = getAbly();
  const channel = ably.channels.get(channelName(sessionId));

  const listener = (msg) => {
    if (msg.data) {
      _sessions[sessionId] = msg.data;
      storeSession(msg.data);
      callback(msg.data);
    }
  };

  channel.subscribe('session-update', listener);

  return () => channel.unsubscribe('session-update', listener);
}

// ─────────────────────────────────────────────────────────
// setGameState — Host starts the game
// Publishes full game state to the channel
// Each player's hand is published on a private sub-channel
// ─────────────────────────────────────────────────────────
export async function setGameState(sessionId, gameState) {
  const ably    = getAbly();
  const channel = ably.channels.get(channelName(sessionId));

  // Store hands separately to be retrieved individually
  // (Ably has no built-in auth/data isolation on free plan, so we publish
  //  all hands in the game-state and let each client read only their own)
  _gameStates[sessionId] = gameState;

  // Update session status
  const session = _sessions[sessionId];
  if (session) {
    session.status   = 'playing';
    session.gameState = true; // flag only
    _sessions[sessionId] = session;
    storeSession(session);
  }

  // Publish game state (includes all hands — clients only render their own)
  await channel.publish('game-state', gameState);

  // Also publish session-update so lobby knows game started
  if (session) {
    await channel.publish('session-update', session);
  }
}

// ─────────────────────────────────────────────────────────
// subscribeToGameState — Listen for game state changes
// Returns unsubscribe function
// ─────────────────────────────────────────────────────────
export function subscribeToGameState(sessionId, callback) {
  const ably    = getAbly();
  const channel = ably.channels.get(channelName(sessionId));

  // Full game state (on game start)
  const onGameState = (msg) => {
    if (msg.data) {
      _gameStates[sessionId] = msg.data;
      callback(msg.data);
    }
  };

  // Partial updates (during turns)
  const onGameUpdate = (msg) => {
    if (msg.data && _gameStates[sessionId]) {
      // Deep merge the update into current state
      const current = _gameStates[sessionId];
      const updated = deepMerge(current, msg.data);
      _gameStates[sessionId] = updated;
      callback(updated);
    }
  };

  channel.subscribe('game-state', onGameState);
  channel.subscribe('game-update', onGameUpdate);

  return () => {
    channel.unsubscribe('game-state', onGameState);
    channel.unsubscribe('game-update', onGameUpdate);
  };
}

// ─────────────────────────────────────────────────────────
// updateGameState — Publish a partial game state update (during turns)
// ─────────────────────────────────────────────────────────
export async function updateGameState(sessionId, updates) {
  const ably    = getAbly();
  const channel = ably.channels.get(channelName(sessionId));

  // Apply locally first for fast feedback
  if (_gameStates[sessionId]) {
    _gameStates[sessionId] = deepMerge(_gameStates[sessionId], updates);
  }

  await channel.publish('game-update', updates);
}

// ─────────────────────────────────────────────────────────
// setPlayerOnline — Broadcast player online status
// ─────────────────────────────────────────────────────────
export async function setPlayerOnline(sessionId, playerId, online) {
  const ably    = getAbly();
  const channel = ably.channels.get(channelName(sessionId));
  await channel.publish('player-online', { playerId, online }).catch(() => {});
}

// ─────────────────────────────────────────────────────────
// isAblyConfigured — Check if Ably API key is set
// ─────────────────────────────────────────────────────────
export function isAblyConfigured() {
  return ABLY_API_KEY !== 'YOUR_ABLY_API_KEY_HERE' && ABLY_API_KEY.length > 10;
}

// ─────────────────────────────────────────────────────────
// deepMerge — Merge two objects recursively
// ─────────────────────────────────────────────────────────
function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const val = source[key];
    if (val !== null && typeof val === 'object' && !Array.isArray(val) &&
        typeof result[key] === 'object' && result[key] !== null && !Array.isArray(result[key])) {
      result[key] = deepMerge(result[key], val);
    } else {
      result[key] = val;
    }
  }
  return result;
}
