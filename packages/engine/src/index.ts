/**
 * @apex/engine — the Apex Poker rules engine.
 *
 * Pure and deterministic: no I/O, no clock, no globals, no dependencies. The
 * only source of randomness is the `Rng` the caller passes in, which is what
 * makes a hand replayable from a seed and the whole subsystem testable
 * without a server (spec §7).
 *
 * The client is never trusted. Cards, winners, pots, chip movement, and which
 * actions are legal are all decided here, on the server, and reach a player
 * only through `projectHandState`.
 */

export {
  cardsToString,
  cardToString,
  DECK_SIZE,
  FULL_DECK,
  findDuplicate,
  assertNoDuplicates,
  makeCard,
  NUM_RANKS,
  NUM_SUITS,
  parseCard,
  parseCards,
  RANK_CHARS,
  RANK_NAMES,
  RANK_NAMES_PLURAL,
  rankOf,
  sortCardsDesc,
  SUIT_CHARS,
  suitOf,
  type Card,
  type Rank,
  type Suit,
} from './cards.js';

export { EngineError, fail, type EngineErrorCode } from './errors.js';

export { secureRng, seededRng, shuffle, type Rng } from './rng.js';
export { sha256Hex } from './sha256.js';
export {
  commitToShuffle,
  generateSeed,
  verifyShuffleCommitment,
  type ShuffleCommitment,
} from './fairness.js';

export {
  burn,
  createDeck,
  createShoe,
  createShoeFromOrder,
  draw,
  drawMany,
  remaining,
  type Shoe,
} from './deck.js';

export {
  compareHands,
  describeHand,
  evaluate,
  HandCategory,
  isRoyalFlush,
  type EvaluatedHand,
} from './hand-evaluator.js';

export { buildPots, findUncalledBet, totalPot, type Pot } from './pot.js';

export {
  awardPots,
  awardUncontested,
  evaluateShowdown,
  seatOrderFromButton,
  type PotAward,
  type ShowdownEntry,
} from './showdown.js';

export {
  actingSeats,
  getLegalActions,
  liveSeats,
  needsToAct,
  nextSeatToAct,
  nextSeatWhere,
  occupiedSeats,
  potSoFar,
  resolveAction,
  seatAt,
  type ResolvedAction,
} from './betting.js';

export { applyAction, cloneState, currentPot, isComplete, startHand } from './game-state.js';

export {
  projectForSpectator,
  projectHandState,
  type PublicSeat,
  type TableView,
} from './projection.js';

export type {
  ActionType,
  EngineEvent,
  HandPhase,
  HandResult,
  HandState,
  LegalActions,
  LoggedAction,
  LoggedActionType,
  PlayerAction,
  SeatSetup,
  SeatState,
  StartHandOptions,
  Street,
} from './types.js';
