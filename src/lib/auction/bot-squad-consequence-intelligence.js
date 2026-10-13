"use strict";
// src/lib/auction/bot-squad-consequence-intelligence.ts
//
// Phase 2H: Squad Acquisition Consequence Intelligence
//
// "If I hypothetically acquire a player of role X, what does my squad
//  look like afterwards?"
//
// This layer constructs a SYNTHETIC PROJECTED BotSquadState by
// hypothetically adding one player of a given role, then feeds that
// projected state through the EXISTING 2B–2F pure functions to produce
// a full projected intelligence snapshot. It then synthesizes a
// consequence score representing the structural impact.
//
// THIS MODULE IS STANDALONE.
// It does NOT modify any existing auction behaviour.
// It does NOT integrate into the live auction tick.
// It does NOT make bidding decisions.
// It does NOT access the database or network.
// It does NOT duplicate any 2A–2F algorithm.
Object.defineProperty(exports, "__esModule", { value: true });
exports.FLEXIBILITY_WEIGHTS = exports.CONSEQUENCE_PENALTIES = exports.CONSEQUENCE_WEIGHTS = void 0;
exports.buildBotSquadConsequenceState = buildBotSquadConsequenceState;
var bot_role_gap_intelligence_1 = require("./bot-role-gap-intelligence");
var bot_squad_quality_intelligence_1 = require("./bot-squad-quality-intelligence");
var bot_squad_priority_intelligence_1 = require("./bot-squad-priority-intelligence");
var bot_squad_target_intelligence_1 = require("./bot-squad-target-intelligence");
var bot_squad_alternative_intelligence_1 = require("./bot-squad-alternative-intelligence");
var server_bot_engine_1 = require("./server-bot-engine");
// ============================================================
// NAMED IMMUTABLE WEIGHT CONFIGURATION
// ============================================================
/**
 * CONSEQUENCE_WEIGHTS: Named immutable synthesis weights for the
 * consequence score formula.
 *
 * Sum MUST equal 1.0. This is validated by tests.
 *
 * These weights are extracted as a named configuration to:
 * - make future tuning explicit and auditable
 * - enable deterministic A/B experimentation
 * - prevent magic numbers inside the formula
 */
exports.CONSEQUENCE_WEIGHTS = {
    projectedSquadQuality: 0.35,
    projectedCompletion: 0.30,
    projectedFlexibility: 0.20,
    priorityStability: 0.15,
};
// ============================================================
// SEVERITY WEIGHTS (URGENT GAPS ONLY)
// ============================================================
/**
 * URGENT_SEVERITY_WEIGHT: Local immutable mapping for urgent gap severity.
 *
 * Phase 2B classifies role gaps as CRITICAL > HIGH > NORMAL > LOW > REDUNDANT.
 * Priority stability measures reduction in URGENT structural pressure only.
 * Therefore only CRITICAL and HIGH gaps contribute to the severity sum.
 * NORMAL, LOW, and REDUNDANT gaps contribute 0.
 *
 * This does NOT duplicate 2B's gap detection algorithm. It only assigns
 * weights to the RoleNeed values that 2B already produces.
 */
var URGENT_SEVERITY_WEIGHT = {
    CRITICAL: 4,
    HIGH: 3,
    NORMAL: 0,
    LOW: 0,
    REDUNDANT: 0,
};
// ============================================================
// CONSEQUENCE PENALTIES
// ============================================================
/**
 * CONSEQUENCE_PENALTIES: Named immutable penalty configuration.
 *
 * criticalGap: 15 — initial tunable structural penalty per projected
 * critical gap. This is intentionally separate from CONSEQUENCE_WEIGHTS.
 * It is NOT a player valuation, bid penalty, or market penalty.
 * It is a structural squad-health penalty applied after the
 * consequence score synthesis.
 */
exports.CONSEQUENCE_PENALTIES = {
    criticalGap: 15,
};
// ============================================================
// FLEXIBILITY WEIGHTS
// ============================================================
/**
 * FLEXIBILITY_WEIGHTS: Named immutable weights for the projected
 * flexibility formula.
 *
 * Projected flexibility accounts for three structural dimensions:
 * - slotFlexibility: how many squad slots remain for future acquisitions
 * - urgentGapFlexibility: how few urgent gaps remain (fewer = more flexible)
 * - alternativeFlexibility: how many meaningful alternative paths exist
 *
 * Sum MUST equal 1.0.
 */
exports.FLEXIBILITY_WEIGHTS = {
    slotFlexibility: 0.35,
    urgentGapFlexibility: 0.30,
    alternativeFlexibility: 0.35,
};
// ============================================================
// HELPERS
// ============================================================
function clamp(val) {
    if (Number.isNaN(val) || !Number.isFinite(val))
        return 0;
    return Math.max(0, Math.min(100, Math.round(val)));
}
var CANONICAL_ORDER = {
    BATSMAN: 4,
    BOWLER: 3,
    ALL_ROUNDER: 2,
    WICKET_KEEPER: 1,
};
var ALL_ROLES = ['BATSMAN', 'BOWLER', 'ALL_ROUNDER', 'WICKET_KEEPER'];
// ============================================================
// SYNTHETIC PROJECTED STATE CONSTRUCTION
// ============================================================
/**
 * Construct a synthetic projected BotSquadState by hypothetically
 * adding one player of the given role to the current squad.
 *
 * This does NOT call buildBotSquadState(). It constructs the state
 * directly from the current BotSquadState, modifying only the
 * role-relevant fields.
 *
 * Financial fields (purse, spent, overseas) are carried forward
 * unchanged because Phase 2H evaluates structural role-level
 * consequences, not player-level financial consequences.
 */
function buildProjectedSquadState(current, acquiredRole) {
    var projectedSquadSize = current.squadSize + 1;
    var maxSquadSize = current.squadSize + current.remainingSlots;
    var projectedRemainingSlots = Math.max(0, current.remainingSlots - 1);
    // Increment the acquired role count by 1
    var projectedComposition = {
        BATSMAN: current.roleComposition.BATSMAN + (acquiredRole === 'BATSMAN' ? 1 : 0),
        BOWLER: current.roleComposition.BOWLER + (acquiredRole === 'BOWLER' ? 1 : 0),
        ALL_ROUNDER: current.roleComposition.ALL_ROUNDER + (acquiredRole === 'ALL_ROUNDER' ? 1 : 0),
        WICKET_KEEPER: current.roleComposition.WICKET_KEEPER + (acquiredRole === 'WICKET_KEEPER' ? 1 : 0),
    };
    // Recompute roleNeeds using the EXISTING exported getRoleNeed()
    var projectedNeeds = {
        BATSMAN: (0, server_bot_engine_1.getRoleNeed)('BATSMAN', projectedComposition.BATSMAN, projectedRemainingSlots, maxSquadSize).need,
        BOWLER: (0, server_bot_engine_1.getRoleNeed)('BOWLER', projectedComposition.BOWLER, projectedRemainingSlots, maxSquadSize).need,
        ALL_ROUNDER: (0, server_bot_engine_1.getRoleNeed)('ALL_ROUNDER', projectedComposition.ALL_ROUNDER, projectedRemainingSlots, maxSquadSize).need,
        WICKET_KEEPER: (0, server_bot_engine_1.getRoleNeed)('WICKET_KEEPER', projectedComposition.WICKET_KEEPER, projectedRemainingSlots, maxSquadSize).need,
    };
    return {
        teamId: current.teamId,
        squadSize: projectedSquadSize,
        remainingSlots: projectedRemainingSlots,
        purseRemaining: current.purseRemaining,
        amountSpent: current.amountSpent,
        spentRatio: current.spentRatio,
        overseasCount: current.overseasCount,
        overseasSlotsRemaining: current.overseasSlotsRemaining,
        roleComposition: projectedComposition,
        roleNeeds: projectedNeeds,
    };
}
/**
 * Run the projected BotSquadState through the EXISTING 2B–2F pipeline.
 * Zero algorithm duplication — calls the actual locked pure functions.
 */
function buildProjectedSnapshot(projectedSquadState) {
    var projectedGapState = (0, bot_role_gap_intelligence_1.buildBotRoleGapState)(projectedSquadState);
    var projectedQualityState = (0, bot_squad_quality_intelligence_1.buildBotSquadQualityState)(projectedSquadState);
    var projectedPriorityState = (0, bot_squad_priority_intelligence_1.buildBotSquadPriorityState)(projectedSquadState, projectedGapState, projectedQualityState);
    var projectedTargetState = (0, bot_squad_target_intelligence_1.buildBotSquadTargetState)(projectedSquadState, projectedGapState, projectedQualityState, projectedPriorityState);
    var projectedAlternativeState = (0, bot_squad_alternative_intelligence_1.buildBotSquadAlternativeState)(projectedSquadState, projectedGapState, projectedQualityState, projectedPriorityState, projectedTargetState);
    return {
        projectedSquadState: projectedSquadState,
        projectedGapState: projectedGapState,
        projectedQualityState: projectedQualityState,
        projectedPriorityState: projectedPriorityState,
        projectedTargetState: projectedTargetState,
        projectedAlternativeState: projectedAlternativeState,
    };
}
// ============================================================
// PRIORITY STABILITY
// ============================================================
/**
 * Compute priority stability using the explicit urgent-severity-weight formula.
 *
 * Only CRITICAL and HIGH gaps contribute to the urgent severity sum.
 * NORMAL, LOW, and REDUNDANT gaps contribute 0.
 *
 * urgentSeverityBefore = sum of URGENT_SEVERITY_WEIGHT for current gaps
 *                        where need is CRITICAL or HIGH
 * urgentSeverityRemaining = sum of URGENT_SEVERITY_WEIGHT for projected gaps
 *                           where need is CRITICAL or HIGH
 *
 * priorityStability = 100 - (urgentSeverityRemaining / max(1, urgentSeverityBefore) * 100)
 *
 * Edge case: if urgentSeverityBefore = 0, there was no urgent pressure
 * to stabilize, so stability is maximal (100).
 */
function computePriorityStability(currentGapState, projectedGapState) {
    var urgentSeverityBefore = 0;
    var urgentSeverityRemaining = 0;
    for (var _i = 0, ALL_ROLES_1 = ALL_ROLES; _i < ALL_ROLES_1.length; _i++) {
        var role = ALL_ROLES_1[_i];
        urgentSeverityBefore += URGENT_SEVERITY_WEIGHT[currentGapState.roles[role].need];
        urgentSeverityRemaining += URGENT_SEVERITY_WEIGHT[projectedGapState.roles[role].need];
    }
    // Edge case: no urgent severity to stabilize → maximal stability
    if (urgentSeverityBefore === 0) {
        return 100;
    }
    return clamp(100 - (urgentSeverityRemaining / Math.max(1, urgentSeverityBefore) * 100));
}
// ============================================================
// PROJECTED FLEXIBILITY
// ============================================================
/**
 * Projected flexibility measures the POST-ACQUISITION structural
 * freedom of the squad.
 *
 * It accounts for three dimensions:
 * - slotFlexibility: how many squad slots remain (more slots = more flexible)
 * - urgentGapFlexibility: how few urgent gaps remain (fewer = more flexible)
 * - alternativeFlexibility: how many meaningful alternative paths exist
 *
 * Uses the EXISTING 2F alternative state output.
 * Does NOT recreate compatibility logic.
 */
function computeProjectedFlexibility(projectedSquadState, projectedGapState, projectedAltState) {
    // 1. Slot flexibility: more remaining slots = more flexible
    var maxSquadSize = Math.max(1, projectedSquadState.squadSize + projectedSquadState.remainingSlots);
    var slotFlexibility = clamp((projectedSquadState.remainingSlots / maxSquadSize) * 100);
    // 2. Urgent gap flexibility: fewer urgent gaps = more flexible (max 4 roles)
    var urgentGaps = projectedGapState.criticalGapRoles + (projectedGapState.totalGapRoles - projectedGapState.criticalGapRoles);
    var urgentGapFlexibility = clamp(100 - (urgentGaps / 4) * 100);
    // 3. Alternative flexibility: from existing 2F output
    var alternativeFlexibility = 20;
    if (projectedAltState.alternativeAvailability === 'ALTERNATIVES_AVAILABLE')
        alternativeFlexibility = 80;
    else if (projectedAltState.alternativeAvailability === 'LIMITED_ALTERNATIVES')
        alternativeFlexibility = 50;
    return clamp(exports.FLEXIBILITY_WEIGHTS.slotFlexibility * slotFlexibility +
        exports.FLEXIBILITY_WEIGHTS.urgentGapFlexibility * urgentGapFlexibility +
        exports.FLEXIBILITY_WEIGHTS.alternativeFlexibility * alternativeFlexibility);
}
// ============================================================
// PROJECTED CONSTRAINT PRESSURE
// ============================================================
/**
 * Projected constraint pressure measures how constrained the franchise
 * becomes after this hypothetical acquisition.
 *
 * Uses projected 2B critical gap count and projected 2F alternative state.
 * Slot scarcity uses the projected remaining slots.
 */
function computeProjectedConstraintPressure(projectedSquadState, projectedGapState, projectedAltState) {
    var maxSquadSize = projectedSquadState.squadSize + projectedSquadState.remainingSlots;
    var initialSlots = Math.max(1, maxSquadSize);
    var slotScarcity = clamp(100 * (1 - projectedSquadState.remainingSlots / initialSlots));
    var criticalPressure = clamp((projectedGapState.criticalGapRoles / 4) * 100);
    var altScarcity = 100;
    if (projectedAltState.alternativeAvailability === 'ALTERNATIVES_AVAILABLE')
        altScarcity = 20;
    else if (projectedAltState.alternativeAvailability === 'LIMITED_ALTERNATIVES')
        altScarcity = 60;
    return clamp((0.45 * slotScarcity) + (0.35 * criticalPressure) + (0.20 * altScarcity));
}
// ============================================================
// RATIONALE GENERATION
// ============================================================
/**
 * Generate a deterministic rationale string.
 *
 * The 2G tradeoffScore is consumed HERE for explainability:
 * it contextualizes the consequence relative to the prior trade-off
 * assessment. This is the ONLY place 2G data enters Phase 2H.
 */
function generateConsequenceRationale(role, finalScore, priorTradeoffScore, projectedCriticalGaps, priorityStability) {
    // Consequence vs prior trade-off comparison
    var tradeoffComparison = finalScore >= priorTradeoffScore + 10
        ? 'Projected consequence exceeds the prior trade-off expectation.'
        : finalScore <= priorTradeoffScore - 10
            ? 'Projected consequence falls below the prior trade-off expectation.'
            : 'Projected consequence is consistent with the prior trade-off assessment.';
    if (projectedCriticalGaps > 0 && priorityStability < 40) {
        return "Acquiring ".concat(role, " leaves ").concat(projectedCriticalGaps, " critical gap(s) unresolved with low priority stability. ").concat(tradeoffComparison);
    }
    if (finalScore >= 70) {
        return "Acquiring ".concat(role, " produces a strong projected squad state. ").concat(tradeoffComparison);
    }
    if (finalScore >= 40) {
        return "Acquiring ".concat(role, " produces a moderate projected improvement. ").concat(tradeoffComparison);
    }
    return "Acquiring ".concat(role, " provides limited structural improvement. ").concat(tradeoffComparison);
}
// ============================================================
// COMPARATOR
// ============================================================
function compareConsequenceOptions(a, b) {
    if (a.finalConsequenceScore !== b.finalConsequenceScore)
        return b.finalConsequenceScore - a.finalConsequenceScore;
    if (a.consequenceScore !== b.consequenceScore)
        return b.consequenceScore - a.consequenceScore;
    if (a.projectedCriticalGaps !== b.projectedCriticalGaps)
        return a.projectedCriticalGaps - b.projectedCriticalGaps;
    if (a.priorityStability !== b.priorityStability)
        return b.priorityStability - a.priorityStability;
    return CANONICAL_ORDER[b.role] - CANONICAL_ORDER[a.role];
}
// ============================================================
// PUBLIC API
// ============================================================
/**
 * Build a BotSquadConsequenceState by projecting each candidate role
 * acquisition through the existing 2B–2F pipeline.
 *
 * - Synchronous
 * - Deterministic (same input → same output)
 * - Pure (no side effects)
 * - Does NOT mutate any input
 * - Does NOT access the database or network
 * - Does NOT make bidding decisions
 * - Does NOT duplicate any 2A–2F algorithm
 * - Does NOT add 2G tradeoffScore to consequenceScore
 *
 * @param squadState    - Current 2A squad state
 * @param gapState      - Current 2B role gap state
 * @param tradeoffState - Current 2G trade-off state (consumed for rationale only)
 */
function buildBotSquadConsequenceState(squadState, gapState, tradeoffState) {
    var _a, _b;
    var currentCriticalGaps = gapState.criticalGapRoles;
    var options = [];
    var _loop_1 = function (role) {
        // 1. Build synthetic projected BotSquadState
        var projectedSquadState = buildProjectedSquadState(squadState, role);
        // 2. Feed through existing 2B–2F pipeline (zero algorithm duplication)
        var snapshot = buildProjectedSnapshot(projectedSquadState);
        // 3. Extract projected metrics from existing function outputs
        var projectedSquadQuality = snapshot.projectedQualityState.overallQuality;
        var projectedCompletion = snapshot.projectedQualityState.squadCompleteness;
        var projectedFlexibility = computeProjectedFlexibility(snapshot.projectedSquadState, snapshot.projectedGapState, snapshot.projectedAlternativeState);
        var priorityStability = computePriorityStability(gapState, snapshot.projectedGapState);
        var projectedCriticalGaps = snapshot.projectedGapState.criticalGapRoles;
        var projectedConstraintPressure = computeProjectedConstraintPressure(snapshot.projectedSquadState, snapshot.projectedGapState, snapshot.projectedAlternativeState);
        // 4. Consequence score synthesis using named weights
        var consequenceScore = clamp(exports.CONSEQUENCE_WEIGHTS.projectedSquadQuality * projectedSquadQuality +
            exports.CONSEQUENCE_WEIGHTS.projectedCompletion * projectedCompletion +
            exports.CONSEQUENCE_WEIGHTS.projectedFlexibility * projectedFlexibility +
            exports.CONSEQUENCE_WEIGHTS.priorityStability * priorityStability);
        // 5. Critical penalty using named configuration
        var criticalPenalty = projectedCriticalGaps * exports.CONSEQUENCE_PENALTIES.criticalGap;
        var finalConsequenceScore = clamp(consequenceScore - criticalPenalty);
        // 6. 2G trade-off context for explainability ONLY
        var tradeoffOption = tradeoffState.tradeoffOrder.includes(role)
            ? (((_a = tradeoffState.primaryOption) === null || _a === void 0 ? void 0 : _a.role) === role
                ? tradeoffState.primaryOption
                : tradeoffState.alternativeOptions.find(function (o) { return o.role === role; }))
            : null;
        var priorTradeoffScore = (_b = tradeoffOption === null || tradeoffOption === void 0 ? void 0 : tradeoffOption.tradeoffScore) !== null && _b !== void 0 ? _b : 0;
        // 7. Rationale
        var rationale = generateConsequenceRationale(role, finalConsequenceScore, priorTradeoffScore, projectedCriticalGaps, priorityStability);
        options.push({
            role: role,
            projectedSquadQuality: projectedSquadQuality,
            projectedCompletion: projectedCompletion,
            projectedFlexibility: projectedFlexibility,
            priorityStability: priorityStability,
            projectedCriticalGaps: projectedCriticalGaps,
            projectedConstraintPressure: projectedConstraintPressure,
            consequenceScore: consequenceScore,
            criticalPenalty: criticalPenalty,
            finalConsequenceScore: finalConsequenceScore,
            priorTradeoffScore: priorTradeoffScore,
            rationale: rationale,
        });
    };
    for (var _i = 0, ALL_ROLES_2 = ALL_ROLES; _i < ALL_ROLES_2.length; _i++) {
        var role = ALL_ROLES_2[_i];
        _loop_1(role);
    }
    // Deterministic sort
    options.sort(compareConsequenceOptions);
    var bestOption = options.length > 0 ? (options[0] || null) : null;
    var consequenceOrder = options.map(function (o) { return o.role; });
    return {
        teamId: squadState.teamId,
        currentCriticalGaps: currentCriticalGaps,
        options: options,
        consequenceOrder: consequenceOrder,
        bestOption: bestOption,
    };
}
