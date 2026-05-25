/**
 * ui.js — UI Helper Utilities
 *
 * Provides:
 * - Card DOM rendering
 * - Toast notifications
 * - Modal management
 * - Confetti effect
 * - General DOM helpers
 */

import { isWildcard } from './deck.js';

const SUIT_SYMBOLS = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣', joker: '🃏' };

// ============================================================
// Card Rendering
// ============================================================

/**
 * Create a card DOM element.
 * @param {Card} card
 * @param {Card|null} secretJoker
 * @param {object} options
 *   - size: 'sm' | 'md' | 'lg'
 *   - clickable: boolean
 *   - selected: boolean
 *   - showBack: boolean
 */
function createCardEl(card, secretJoker = null, options = {}) {
  const { size = 'md', clickable = false, selected = false, showBack = false } = options;

  if (showBack) {
    const back = document.createElement('div');
    back.className = `card-back${size === 'sm' ? ' card-back-sm' : size === 'lg' ? ' card-back-lg' : ''}`;
    return back;
  }

  const el = document.createElement('div');
  const sizeClass = size === 'sm' ? ' card-sm' : size === 'lg' ? ' card-lg' : '';
  el.className = `card${sizeClass}${selected ? ' selected' : ''}`;
  el.dataset.cardId = card.id;
  el.dataset.suit   = card.suit;
  el.dataset.rank   = card.rank;

  const wild = secretJoker && isWildcard(card, secretJoker);
  if (wild) el.classList.add('joker-used');

  if (card.isPrintedJoker || card.suit === 'joker') {
    el.innerHTML = `
      <div class="card-corner">
        <div class="card-rank">JKR</div>
        <div class="card-suit-small">🃏</div>
      </div>
      <div class="joker-label">JOKER</div>
      <div class="card-corner bottom">
        <div class="card-rank">JKR</div>
        <div class="card-suit-small">🃏</div>
      </div>
    `;
  } else {
    const sym = SUIT_SYMBOLS[card.suit] || card.suit;
    el.innerHTML = `
      <div class="card-corner">
        <div class="card-rank">${card.rank}</div>
        <div class="card-suit-small">${sym}</div>
      </div>
      <div class="card-suit-center">${sym}</div>
      <div class="card-corner bottom">
        <div class="card-rank">${card.rank}</div>
        <div class="card-suit-small">${sym}</div>
      </div>
    `;
  }

  // Add wildcard indicator
  if (wild && !card.isPrintedJoker) {
    const badge = document.createElement('div');
    badge.style.cssText = `
      position:absolute; top:2px; right:2px;
      width:12px; height:12px; border-radius:50%;
      background:#C9A84C; font-size:7px;
      display:flex; align-items:center; justify-content:center;
      color:#0D1B2A; font-weight:800;
    `;
    badge.textContent = '★';
    el.style.position = 'relative';
    el.appendChild(badge);
  }

  return el;
}

/**
 * Render a full hand of cards into a container element.
 * @param {HTMLElement} container
 * @param {Card[]} cards
 * @param {Card|null} secretJoker
 * @param {Set<string>} selectedIds — set of selected card IDs
 * @param {Function} onCardClick — (card) => void
 */
function renderHand(container, cards, secretJoker, selectedIds = new Set(), onCardClick = null) {
  container.innerHTML = '';
  cards.forEach((card, i) => {
    const el = createCardEl(card, secretJoker, {
      selected: selectedIds.has(card.id),
    });

    if (onCardClick) {
      el.addEventListener('click', () => onCardClick(card, el));
      el.addEventListener('touchend', (e) => {
        e.preventDefault();
        onCardClick(card, el);
      }, { passive: false });
    }

    // Stagger deal animation
    el.style.animationDelay = `${i * 40}ms`;
    el.classList.add('card-dealing');

    container.appendChild(el);
  });
}

/**
 * Render opponent info panel.
 */
function renderOpponentPanel(player, isMyTurn = false) {
  const panel = document.createElement('div');
  panel.className = `opponent-panel${isMyTurn ? ' active-turn' : ''}${!player.online ? ' disconnected' : ''}`;
  panel.dataset.playerId = player.id;

  const cardCount = player.cardCount ?? 13;
  const handHtml = Array.from({ length: Math.min(cardCount, 8) }, (_, i) =>
    `<div class="card-back card-back-sm" style="margin-left:${i > 0 ? '-20px' : '0'}"></div>`
  ).join('');

  panel.innerHTML = `
    <div class="opponent-avatar">
      ${player.avatar || '🎴'}
      <div class="opponent-online-dot${player.online ? '' : ' offline'}"></div>
    </div>
    <div class="opponent-name">${escHtml(player.name)}</div>
    <div class="opponent-hand">${handHtml}</div>
    <div class="opponent-card-count">🃏 ${cardCount} cards</div>
  `;

  return panel;
}

// ============================================================
// Toast Notifications
// ============================================================

let toastContainer = null;

function getToastContainer() {
  if (!toastContainer) {
    toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
      toastContainer = document.createElement('div');
      toastContainer.id = 'toast-container';
      toastContainer.className = 'toast-container';
      document.body.appendChild(toastContainer);
    }
  }
  return toastContainer;
}

/**
 * Show a toast notification.
 * @param {string} message
 * @param {'success'|'error'|'info'|'warning'} type
 * @param {number} duration — ms before auto-hide
 */
function showToast(message, type = 'info', duration = 3500) {
  const container = getToastContainer();
  const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${icons[type] || '💬'}</span><span>${escHtml(message)}</span>`;
  container.appendChild(toast);

  const remove = () => {
    toast.classList.add('toast-exit');
    setTimeout(() => toast.remove(), 300);
  };

  const timer = setTimeout(remove, duration);
  toast.addEventListener('click', () => { clearTimeout(timer); remove(); });

  return remove;
}

// ============================================================
// Modal
// ============================================================

/**
 * Show a modal with custom content.
 * @param {{ title, content, actions }} opts
 * @returns {{ close: Function, overlay: HTMLElement }}
 */
function showModal({ title = '', subtitle = '', content = '', actions = [] } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const actionsHtml = actions.map(a =>
    `<button class="btn ${a.class || 'btn-ghost'}" id="modal-action-${a.id || Math.random()}">${escHtml(a.label)}</button>`
  ).join('');

  overlay.innerHTML = `
    <div class="modal glass">
      ${title ? `<div class="modal-title">${escHtml(title)}</div>` : ''}
      ${subtitle ? `<div class="modal-subtitle">${escHtml(subtitle)}</div>` : ''}
      <div class="modal-body">${content}</div>
      ${actionsHtml ? `<div class="flex gap-3 justify-center" style="margin-top:1.5rem">${actionsHtml}</div>` : ''}
    </div>
  `;

  document.body.appendChild(overlay);

  // Bind action callbacks
  actions.forEach(a => {
    const btn = overlay.querySelector(`#modal-action-${a.id || ''}`) ||
      overlay.querySelectorAll('.btn')[actions.indexOf(a)];
    if (btn && a.onClick) btn.addEventListener('click', () => a.onClick(close));
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  function close() { overlay.remove(); }
  return { close, overlay };
}

// ============================================================
// Confetti
// ============================================================

function launchConfetti(count = 80) {
  const colors = ['#C9A84C', '#4CAF77', '#4AABDB', '#E84055', '#F0A840', '#E8EFF7'];
  const shapes = ['square', 'circle'];

  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.className = 'confetti-particle';
    const color = colors[Math.floor(Math.random() * colors.length)];
    const shape = shapes[Math.floor(Math.random() * shapes.length)];
    el.style.cssText = `
      left: ${Math.random() * 100}vw;
      background: ${color};
      border-radius: ${shape === 'circle' ? '50%' : '2px'};
      width: ${6 + Math.random() * 8}px;
      height: ${6 + Math.random() * 8}px;
      animation-duration: ${2 + Math.random() * 3}s;
      animation-delay: ${Math.random() * 1}s;
    `;
    document.body.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
  }
}

// ============================================================
// Timer Ring
// ============================================================

/**
 * Update the SVG timer ring.
 * @param {HTMLElement} ringEl — the .timer-ring element
 * @param {number} secondsLeft
 * @param {number} totalSeconds
 */
function updateTimerRing(ringEl, secondsLeft, totalSeconds = 30) {
  const circle = ringEl.querySelector('.timer-progress');
  const numEl  = ringEl.querySelector('.timer-number');
  if (!circle || !numEl) return;

  const r = 13;
  const circumference = 2 * Math.PI * r;
  const progress = secondsLeft / totalSeconds;
  circle.style.strokeDasharray  = `${circumference}`;
  circle.style.strokeDashoffset = `${circumference * (1 - progress)}`;
  numEl.textContent = secondsLeft;

  circle.classList.remove('urgent', 'warning');
  if (secondsLeft <= 5)  circle.classList.add('urgent');
  else if (secondsLeft <= 10) circle.classList.add('warning');
}

// ============================================================
// Helpers
// ============================================================

function escHtml(str) {
  if (typeof str !== 'string') return String(str ?? '');
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(dateStr) {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }).format(new Date(dateStr));
  } catch {
    return dateStr;
  }
}

function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
  return Promise.resolve();
}

function animateIn(el, delay = 0) {
  el.style.opacity = '0';
  el.style.transform = 'translateY(16px)';
  setTimeout(() => {
    el.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
    el.style.opacity = '1';
    el.style.transform = 'translateY(0)';
  }, delay);
}

export {
  createCardEl,
  renderHand,
  renderOpponentPanel,
  showToast,
  showModal,
  launchConfetti,
  updateTimerRing,
  escHtml,
  formatDate,
  copyToClipboard,
  animateIn,
};
