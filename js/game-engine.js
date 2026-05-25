/**
 * game-engine.js — Rummy Rules Validation Engine
 *
 * Rules:
 * - A SEQUENCE = 3 or more consecutive cards of the same suit.
 * - A PURE SEQUENCE = sequence with NO wildcards.
 * - A TRIPLET = 3 or more cards of the same rank (different suits).
 * - To DECLARE:
 *   1. At least 2 sequences (one must be pure)
 *   2. Remaining cards can be any mix of sequences or triplets
 *   3. All 13 cards must be accounted for in valid groups
 */

import { isWildcard, rankValue } from './deck.js';

/**
 * Sort cards by value (internal helper)
 */
function sortByValue(cards) {
  return [...cards].sort((a, b) => a.value - b.value);
}

/**
 * Find all possible sequences (3+ consecutive same-suit cards)
 * Returns arrays of card groups.
 */
function findSequences(cards, secretJoker) {
  const suitGroups = {};
  const wildcards = [];

  for (const card of cards) {
    if (isWildcard(card, secretJoker)) {
      wildcards.push(card);
    } else {
      if (!suitGroups[card.suit]) suitGroups[card.suit] = [];
      suitGroups[card.suit].push(card);
    }
  }

  const allSequences = [];

  for (const suit of Object.keys(suitGroups)) {
    const suited = sortByValue(suitGroups[suit]);
    // Try to find sequences using a backtracking approach
    const seqs = extractSequences(suited, wildcards, secretJoker);
    allSequences.push(...seqs);
  }

  return allSequences;
}


/**
 * Extract sequences from a sorted same-suit array, optionally using wildcards.
 * Returns an array of sequence groups (each group is Card[]).
 */
function extractSequences(suited, wildcards, secretJoker) {
  const sequences = [];

  // Sliding window: look for runs of 3+
  for (let start = 0; start < suited.length - 1; start++) {
    let run = [suited[start]];
    let wildcardPool = [...wildcards];
    let prev = suited[start].value;

    for (let i = start + 1; i < suited.length; i++) {
      const curr = suited[i].value;
      const gap  = curr - prev;

      if (gap === 0) continue; // duplicate value, skip

      if (gap === 1) {
        run.push(suited[i]);
        prev = curr;
      } else if (gap <= wildcardPool.length + 1) {
        // Fill the gap with wildcards
        const jokersNeeded = gap - 1;
        const usedJokers = wildcardPool.splice(0, jokersNeeded);
        run.push(...usedJokers, suited[i]);
        prev = curr;
      } else {
        break; // gap too large
      }
    }

    if (run.length >= 3) {
      // Also try inserting wildcards at the start/end for longer sequences
      sequences.push({
        cards: run,
        isPure: !run.some(c => isWildcard(c, secretJoker)),
        type: 'sequence',
      });
    }
  }

  return sequences;
}

/**
 * Find all triplets (3+ cards of same rank, different suits).
 */
function findTriplets(cards, secretJoker) {
  const rankGroups = {};
  const wildcards = [];

  for (const card of cards) {
    if (isWildcard(card, secretJoker)) {
      wildcards.push(card);
      continue;
    }
    if (!rankGroups[card.rank]) rankGroups[card.rank] = [];
    rankGroups[card.rank].push(card);
  }

  const triplets = [];

  for (const rank of Object.keys(rankGroups)) {
    const group = rankGroups[rank];
    if (group.length >= 3) {
      triplets.push({ cards: group, isPure: true, type: 'triplet' });
    } else if (group.length + wildcards.length >= 3) {
      const needed = 3 - group.length;
      const jokers = wildcards.slice(0, needed);
      triplets.push({ cards: [...group, ...jokers], isPure: false, type: 'triplet' });
    }
  }

  return triplets;
}

/**
 * Validate a hand for declaring.
 * Returns { valid, reason, groups, pureSeqCount, seqCount }
 *
 * @param {Card[]} hand — player's 13 cards
 * @param {Card} secretJoker — the secret wildcard card
 * @param {Group[]} userGroups — player's manually arranged groups (optional)
 */
function validateHand(hand, secretJoker, userGroups = null) {
  if (hand.length !== 13) {
    return { valid: false, reason: 'Hand must have exactly 13 cards', groups: [] };
  }

  // If user provided explicit groups, validate those
  if (userGroups && userGroups.length > 0) {
    return validateUserGroups(hand, secretJoker, userGroups);
  }

  // Auto-detect best arrangement
  return autoValidate(hand, secretJoker);
}

/**
 * Validate user-arranged groups (drag-and-drop grouping)
 */
function validateUserGroups(hand, secretJoker, groups) {
  const allGroupedCards = groups.flatMap(g => g.cards);
  
  // Check all cards are accounted for
  if (allGroupedCards.length !== 13) {
    return {
      valid: false,
      reason: 'All 13 cards must be organized into groups',
      groups,
      checks: buildChecks(groups, secretJoker, false, false),
    };
  }

  const sequences = groups.filter(g => g.type === 'sequence');
  const pureSeqs  = sequences.filter(g => g.isPure);
  const triplets  = groups.filter(g => g.type === 'triplet');

  // Validate each group
  const groupResults = groups.map(g => validateGroup(g, secretJoker));
  const invalidGroups = groupResults.filter(r => !r.valid);

  if (invalidGroups.length > 0) {
    return {
      valid: false,
      reason: `Invalid group: ${invalidGroups[0].reason}`,
      groups,
      checks: buildChecks(groups, secretJoker, false, false),
    };
  }

  const hasEnoughSequences = sequences.length >= 2;
  const hasOnePure         = pureSeqs.length >= 1;

  if (!hasEnoughSequences) {
    return {
      valid: false,
      reason: 'You need at least 2 sequences',
      groups,
      checks: buildChecks(groups, secretJoker, hasOnePure, hasEnoughSequences),
    };
  }

  if (!hasOnePure) {
    return {
      valid: false,
      reason: 'At least 1 sequence must be a pure sequence (no jokers)',
      groups,
      checks: buildChecks(groups, secretJoker, hasOnePure, hasEnoughSequences),
    };
  }

  return {
    valid: true,
    reason: 'Valid declaration! 🎉',
    groups,
    pureSeqCount: pureSeqs.length,
    seqCount: sequences.length,
    tripletCount: triplets.length,
    checks: buildChecks(groups, secretJoker, true, true),
  };
}

/**
 * Validate a single group (sequence or triplet).
 */
function validateGroup(group, secretJoker) {
  const { cards, type } = group;
  if (!cards || cards.length < 3) {
    return { valid: false, reason: `${type} needs at least 3 cards` };
  }

  const wilds = cards.filter(c => isWildcard(c, secretJoker));
  const reals  = cards.filter(c => !isWildcard(c, secretJoker));

  if (type === 'sequence') {
    if (reals.length === 0) {
      return { valid: false, reason: 'Sequence must have at least 1 non-joker card' };
    }
    return validateSequenceCards(reals, wilds, secretJoker);
  }

  if (type === 'triplet') {
    if (reals.length === 0) {
      return { valid: false, reason: 'Triplet must have at least 1 non-joker card' };
    }
    // All real cards must be same rank
    const ranks = [...new Set(reals.map(c => c.rank))];
    if (ranks.length > 1) {
      return { valid: false, reason: 'All cards in a triplet must be the same rank' };
    }
    // All real cards must be different suits (for standard rummy triplet)
    const suits = reals.map(c => c.suit);
    const uniqueSuits = new Set(suits);
    if (uniqueSuits.size !== suits.length) {
      return { valid: false, reason: 'Triplet cannot have duplicate suits' };
    }
    return { valid: true };
  }

  return { valid: false, reason: 'Unknown group type' };
}

/**
 * Validate that cards form a valid sequence.
 * Real cards must be same suit and consecutive (wildcards fill gaps).
 */
function validateSequenceCards(reals, wilds, secretJoker) {
  // All non-wild cards must be same suit
  const suits = [...new Set(reals.map(c => c.suit))];
  if (suits.length > 1) {
    return { valid: false, reason: 'Sequence must be all same suit' };
  }

  const sorted = [...reals].sort((a, b) => a.value - b.value);
  let wildCount = wilds.length;

  // Check that gaps between consecutive cards can be filled by wildcards
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].value - sorted[i - 1].value;
    if (gap <= 0) return { valid: false, reason: 'Duplicate card in sequence' };
    const gapNeeded = gap - 1;
    wildCount -= gapNeeded;
    if (wildCount < 0) return { valid: false, reason: 'Not enough wildcards to fill sequence gaps' };
  }

  return { valid: true };
}

/**
 * Auto-validate by trying all permutations.
 * Simplified greedy approach: find 2 sequences first, then check rest.
 */
function autoValidate(hand, secretJoker) {
  const sequences = findSequences(hand, secretJoker);
  const pureSeqs  = sequences.filter(s => s.isPure);

  if (pureSeqs.length === 0) {
    return {
      valid: false,
      reason: 'No pure sequence found. You need at least 1 pure sequence.',
      groups: [],
    };
  }
  if (sequences.length < 2) {
    return {
      valid: false,
      reason: 'Need at least 2 sequences. Try grouping your cards.',
      groups: [],
    };
  }

  return {
    valid: false,
    reason: 'Please arrange your cards into groups and try declaring again.',
    groups: [],
  };
}

/**
 * Build check result list for the declare UI.
 */
function buildChecks(groups, secretJoker, hasOnePure, hasEnoughSeq) {
  const sequences = groups.filter(g => g.type === 'sequence');
  const pureSeqs  = sequences.filter(g => g.isPure);

  return [
    {
      label: 'At least 2 sequences',
      detail: `You have ${sequences.length} sequence(s)`,
      pass: sequences.length >= 2,
    },
    {
      label: 'At least 1 pure sequence (no jokers)',
      detail: `You have ${pureSeqs.length} pure sequence(s)`,
      pass: pureSeqs.length >= 1,
    },
    {
      label: 'All 13 cards are grouped',
      detail: `${groups.flatMap(g => g.cards).length} / 13 cards grouped`,
      pass: groups.flatMap(g => g.cards).length === 13,
    },
    {
      label: 'All groups are valid (3+ cards)',
      detail: 'Each sequence/triplet has minimum 3 cards',
      pass: groups.every(g => g.cards.length >= 3),
    },
  ];
}

/**
 * Calculate points in unmatched cards (for losers).
 */
function calculatePoints(hand, secretJoker) {
  return hand.reduce((sum, card) => {
    if (isWildcard(card, secretJoker)) return sum;
    const v = card.value;
    if (['J', 'Q', 'K'].includes(card.rank)) return sum + 10;
    return sum + v;
  }, 0);
}

/**
 * Get a human-friendly group label.
 */
function groupLabel(group) {
  if (group.type === 'sequence') {
    return group.isPure ? 'PURE' : 'SEQ';
  }
  return 'SET';
}

export {
  findSequences,
  findTriplets,
  validateHand,
  validateGroup,
  calculatePoints,
  groupLabel,
  buildChecks,
};
