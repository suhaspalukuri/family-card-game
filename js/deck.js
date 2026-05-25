/**
 * deck.js — Card Deck Logic
 * Two standard 52-card decks + 2 Joker cards = 106 cards total
 */

const SUITS   = ['spades', 'hearts', 'diamonds', 'clubs'];
const RANKS   = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUIT_SYMBOLS = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣', joker: '🃏' };

/**
 * Create a standard 52-card deck.
 * @param {number} deckIndex — 0 or 1, used to create unique card IDs
 */
function createDeck(deckIndex) {
  const cards = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      cards.push({
        id:     `${deckIndex}_${suit}_${rank}`,
        suit,
        rank,
        symbol: SUIT_SYMBOLS[suit],
        value:  rankValue(rank),
        isJoker: false,
      });
    }
  }
  // Add the printed Joker card
  cards.push({
    id:     `${deckIndex}_joker`,
    suit:   'joker',
    rank:   'JKR',
    symbol: '🃏',
    value:  0,
    isJoker: true,
    isPrintedJoker: true,
  });
  return cards;
}

/** Numeric value for scoring / sorting */
function rankValue(rank) {
  const map = {
    'A': 1, '2': 2, '3': 3, '4': 4, '5': 5,
    '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
    'J': 11, 'Q': 12, 'K': 13, 'JKR': 0,
  };
  return map[rank] ?? 0;
}

/** Fisher-Yates shuffle */
function shuffle(array) {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Create and shuffle two decks (106 cards).
 * @returns {Card[]} shuffled full deck
 */
function createFullDeck() {
  return shuffle([...createDeck(0), ...createDeck(1)]);
}

/**
 * Deal cards to players and set up game state.
 * @param {number} playerCount — 2–6
 * @returns {{ hands: Object, drawPile: Card[], discardPile: Card[], secretJoker: Card }}
 */
function dealCards(playerCount, playerIds) {
  const deck = createFullDeck();
  const hands = {};

  // Deal 13 cards to each player
  for (const pid of playerIds) {
    hands[pid] = deck.splice(0, 13);
  }

  // Pick one random card from the remaining deck as the Secret Joker
  // The Secret Joker cannot be a Printed Joker
  const nonJokerIndexes = deck
    .map((c, i) => (!c.isPrintedJoker ? i : -1))
    .filter(i => i !== -1);
  
  const secretJokerIndex = nonJokerIndexes[Math.floor(Math.random() * nonJokerIndexes.length)];
  const [secretJoker] = deck.splice(secretJokerIndex, 1);
  secretJoker.isSecretJoker = true;

  // Mark Secret Joker's rank+suit counterparts in all hands
  // (we don't modify the cards, just store the reference)

  // First discard card to start the discard pile
  const firstDiscard = deck.splice(0, 1);

  return {
    hands,
    drawPile:    deck,
    discardPile: firstDiscard,
    secretJoker,
  };
}

/**
 * Sort a hand of cards — by suit then rank value.
 * @param {Card[]} cards
 * @returns {Card[]} sorted copy
 */
function sortBySuit(cards) {
  const order = { spades: 0, hearts: 1, diamonds: 2, clubs: 3, joker: 4 };
  return [...cards].sort((a, b) => {
    if (order[a.suit] !== order[b.suit]) return order[a.suit] - order[b.suit];
    return a.value - b.value;
  });
}

/**
 * Sort a hand by rank value across all suits.
 */
function sortByRank(cards) {
  return [...cards].sort((a, b) => a.value - b.value);
}

/**
 * Check if a card is a wildcard (Joker) given the secret joker.
 * @param {Card} card
 * @param {Card} secretJoker
 * @returns {boolean}
 */
function isWildcard(card, secretJoker) {
  if (card.isPrintedJoker) return true;
  if (!secretJoker) return false;
  return card.rank === secretJoker.rank; // Any card of the same RANK as secret joker
}

/**
 * Get point value of a card (for scoring when game ends with a loser).
 */
function cardPoints(card, secretJoker) {
  if (isWildcard(card, secretJoker)) return 0;
  if (card.rank === 'A') return 1;
  if (['J', 'Q', 'K'].includes(card.rank)) return 10;
  return card.value;
}

export {
  SUITS,
  RANKS,
  SUIT_SYMBOLS,
  createFullDeck,
  dealCards,
  sortBySuit,
  sortByRank,
  isWildcard,
  cardPoints,
  rankValue,
  shuffle,
};
