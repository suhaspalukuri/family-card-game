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

function getSubsets(arr) {
  const result = [[]];
  for (const x of arr) {
    const len = result.length;
    for (let i = 0; i < len; i++) {
      result.push([...result[i], x]);
    }
  }
  return result;
}

function calculateGaps(sortedReals) {
  let gaps = 0;
  for (let i = 1; i < sortedReals.length; i++) {
    const diff = sortedReals[i].value - sortedReals[i - 1].value;
    if (diff <= 0) return -1; // duplicate rank, invalid
    gaps += diff - 1;
  }
  return gaps;
}

function checkSequenceReals(reals) {
  const sortedNormal = [...reals].sort((a, b) => a.value - b.value);
  const gapsNormal = calculateGaps(sortedNormal);

  const hasAce = reals.some(c => c.rank === 'A');
  if (hasAce) {
    const mapped = reals.map(c => c.rank === 'A' ? { ...c, value: 14 } : c);
    const sortedAce14 = mapped.sort((a, b) => a.value - b.value);
    const gapsAce14 = calculateGaps(sortedAce14);
    
    if (gapsNormal !== -1 && gapsAce14 !== -1) {
      return Math.min(gapsNormal, gapsAce14);
    }
    if (gapsNormal !== -1) return gapsNormal;
    if (gapsAce14 !== -1) return gapsAce14;
    return -1;
  }
  return gapsNormal;
}

function isCandidatePure(cards) {
  if (cards.some(c => c.isPrintedJoker)) return false;
  const suit = cards[0].suit;
  if (cards.some(c => c.suit !== suit)) return false;
  const gaps = checkSequenceReals(cards);
  return gaps === 0;
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
    const suited = suitGroups[suit];
    const subsets = getSubsets(suited);
    for (const reals of subsets) {
      if (reals.length === 0) continue;
      const gaps = checkSequenceReals(reals);
      if (gaps === -1) continue;
      if (gaps > wildcards.length) continue;

      const minWilds = Math.max(gaps, 3 - reals.length);
      const maxWilds = wildcards.length;

      for (let w = minWilds; w <= maxWilds; w++) {
        const wildcardCombos = getCombinations(wildcards, w);
        for (const chosenWilds of wildcardCombos) {
          const comboCards = [...reals, ...chosenWilds];
          allSequences.push({
            cards: comboCards,
            isPure: isCandidatePure(comboCards),
            type: 'sequence',
          });
        }
      }
    }
  }

  return allSequences;
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
    // Filter duplicates of the same suit in the triplet (standard Indian Rummy triplet rule: different suits)
    const uniqueSuitCards = [];
    const seenSuits = new Set();
    group.forEach(c => {
      if (!seenSuits.has(c.suit)) {
        seenSuits.add(c.suit);
        uniqueSuitCards.push(c);
      }
    });

    // Generate triplet candidates of size 3 and 4
    for (let size of [3, 4]) {
      for (let r = 1; r <= Math.min(size, uniqueSuitCards.length); r++) {
        const w = size - r;
        if (w <= wildcards.length) {
          const combos = getCombinations(uniqueSuitCards, r);
          combos.forEach(combo => {
            const jokerCombos = getCombinations(wildcards, w);
            jokerCombos.forEach(chosenJokers => {
              triplets.push({
                cards: [...combo, ...chosenJokers],
                isPure: w === 0,
                type: 'triplet'
              });
            });
          });
        }
      }
    }
  }

  return triplets;
}

function getCombinations(arr, k) {
  const results = [];
  function helper(start, combo) {
    if (combo.length === k) {
      results.push([...combo]);
      return;
    }
    for (let i = start; i < arr.length; i++) {
      combo.push(arr[i]);
      helper(i + 1, combo);
      combo.pop();
    }
  }
  helper(0, []);
  return results;
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

  const gaps = checkSequenceReals(reals);
  if (gaps === -1) {
    return { valid: false, reason: 'Duplicate card or invalid ranks in sequence' };
  }

  if (wilds.length < gaps) {
    return { valid: false, reason: 'Not enough wildcards to fill sequence gaps' };
  }

  return { valid: true };
}

/**
 * Auto-validate by trying all permutations.
 * Simplified greedy approach: find 2 sequences first, then check rest.
 */
function autoValidate(hand, secretJoker) {
  const seqCandidates = findSequences(hand, secretJoker);
  const tripletCandidates = findTriplets(hand, secretJoker);
  const allCandidates = [...seqCandidates, ...tripletCandidates];

  let bestGroups = [];
  let bestGroupedCount = 0;
  let bestIsValid = false;

  function search(index, currentGroups, usedCardIds) {
    const groupedCount = currentGroups.reduce((sum, g) => sum + g.cards.length, 0);
    const seqs = currentGroups.filter(g => g.type === 'sequence');
    const pureSeqs = seqs.filter(g => g.isPure);
    const isValidDeclare = groupedCount === 13 && seqs.length >= 2 && pureSeqs.length >= 1;

    if (isValidDeclare) {
      bestGroups = [...currentGroups];
      bestGroupedCount = 13;
      bestIsValid = true;
      return true; // Found a winning layout!
    }

    if (groupedCount > bestGroupedCount || (groupedCount === bestGroupedCount && !bestIsValid)) {
      bestGroups = [...currentGroups];
      bestGroupedCount = groupedCount;
    }

    for (let i = index; i < allCandidates.length; i++) {
      const cand = allCandidates[i];
      const overlaps = cand.cards.some(c => usedCardIds.has(c.id));
      if (overlaps) continue;

      const nextUsed = new Set(usedCardIds);
      cand.cards.forEach(c => nextUsed.add(c.id));
      currentGroups.push(cand);

      const foundWin = search(i + 1, currentGroups, nextUsed);
      if (foundWin) return true;

      currentGroups.pop();
    }
    return false;
  }

  search(0, [], new Set());

  if (bestIsValid) {
    return {
      valid: true,
      reason: 'Valid declaration! 🎉',
      groups: bestGroups,
      pureSeqCount: bestGroups.filter(g => g.type === 'sequence' && g.isPure).length,
      seqCount: bestGroups.filter(g => g.type === 'sequence').length,
      tripletCount: bestGroups.filter(g => g.type === 'triplet').length,
      checks: buildChecks(bestGroups, secretJoker, true, true),
    };
  }

  const usedIds = new Set(bestGroups.flatMap(g => g.cards.map(c => c.id)));
  const unmatched = hand.filter(c => !usedIds.has(c.id));

  const finalGroups = [...bestGroups];
  if (unmatched.length > 0) {
    finalGroups.push({ cards: unmatched, type: 'unmatched', isPure: false });
  }

  const seqs = bestGroups.filter(g => g.type === 'sequence');
  const pureSeqs = seqs.filter(g => g.isPure);
  let reason = 'All 13 cards must be organized into valid groups.';
  if (pureSeqs.length === 0) {
    reason = 'You need at least 1 pure sequence (no jokers).';
  } else if (seqs.length < 2) {
    reason = 'You need at least 2 sequences.';
  }

  return {
    valid: false,
    reason,
    groups: finalGroups,
    checks: buildChecks(finalGroups, secretJoker, pureSeqs.length >= 1, seqs.length >= 2),
  };
}

function findBestGrouping(hand, secretJoker) {
  const res = autoValidate(hand, secretJoker);
  return { valid: res.valid, groups: res.groups };
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
  findBestGrouping,
};
