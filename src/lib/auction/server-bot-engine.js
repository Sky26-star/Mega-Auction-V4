"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CONTEXT = void 0;
exports.getNextBidAmount = getNextBidAmount;
exports.getBotPersonality = getBotPersonality;
exports.getRoleNeed = getRoleNeed;
exports.estimateQualityFromCategory = estimateQualityFromCategory;
exports.computeFutureQualityMap = computeFutureQualityMap;
exports.computeFutureOverseasByRole = computeFutureOverseasByRole;
exports.evaluateBotsForLot = evaluateBotsForLot;
var bot_intelligence_orchestrator_1 = require("./bot-intelligence-orchestrator");
var bot_candidate_alignment_1 = require("./bot-candidate-alignment");
var bot_strategic_adapter_1 = require("./bot-strategic-adapter");
var bot_q_engine_1 = require("./bot-q-engine");
var bot_tactical_engine_1 = require("./bot-tactical-engine");
var bot_brain_state_1 = require("./bot-brain-state");
var bot_brain_memory_1 = require("./bot-brain-memory");
var human_auction_manager_context_1 = require("./human-auction-manager-context");
var human_auction_market_value_1 = require("./human-auction-market-value");
var human_auction_team_value_1 = require("./human-auction-team-value");
var human_auction_maximum_bid_1 = require("./human-auction-maximum-bid");
var human_auction_decision_1 = require("./human-auction-decision");
exports.DEFAULT_CONTEXT = {
    maxSquadSize: 25,
    maxOverseas: 8,
    totalLots: 50,
    futurePlayers: [],
    futureByRole: {},
    futureOverseasCount: 0,
    futureAvgBasePrice: 100,
    futureMinBasePrice: 20,
    teamPurchasePrices: {},
    lotsCompleted: 0,
    lotsRemaining: 50,
    auctionProgress: 0,
    futureByRoleAndQuality: {},
    futureOverseasByRole: {},
};
// ============================================================
// CORE UTILITIES
// ============================================================
function getNextBidAmount(currentBid, basePrice) {
    if (currentBid === 0)
        return basePrice;
    var inc = 200;
    if (currentBid <= 300)
        inc = 25;
    else if (currentBid <= 600)
        inc = 50;
    else if (currentBid <= 1000)
        inc = 75;
    else if (currentBid <= 1500)
        inc = 100;
    else if (currentBid <= 2000)
        inc = 150;
    else if (currentBid <= 2500)
        inc = 175;
    return currentBid + inc;
}
function getBotPersonality(teamId) {
    var hash = teamId.charCodeAt(0) + teamId.charCodeAt(teamId.length - 1) + teamId.length;
    var val = hash % 5;
    switch (val) {
        case 0: return 'CONSERVATIVE';
        case 1: return 'AGGRESSIVE';
        case 2: return 'OPPORTUNISTIC';
        case 3: return 'STRATEGIC';
        default: return 'BALANCED';
    }
}
// ============================================================
// DYNAMIC SQUAD EVALUATION
// ============================================================
function getRoleNeed(role, roleCount, remainingSlots, maxSquadSize) {
    var scale = Math.max(0.5, maxSquadSize / 25);
    var minTarget, idealTarget;
    switch (role) {
        case 'WICKET_KEEPER':
            minTarget = Math.max(1, Math.round(2 * scale));
            idealTarget = Math.max(2, Math.round(3 * scale));
            break;
        case 'BATSMAN':
            minTarget = Math.max(2, Math.round(5 * scale));
            idealTarget = Math.max(3, Math.round(7 * scale));
            break;
        case 'ALL_ROUNDER':
            minTarget = Math.max(2, Math.round(3 * scale));
            idealTarget = Math.max(3, Math.round(5 * scale));
            break;
        case 'BOWLER':
            minTarget = Math.max(2, Math.round(6 * scale));
            idealTarget = Math.max(3, Math.round(8 * scale));
            break;
        default:
            minTarget = Math.max(1, Math.round(2 * scale));
            idealTarget = Math.max(2, Math.round(4 * scale));
    }
    var need;
    if (roleCount === 0 && minTarget >= 1) {
        need = 'CRITICAL';
    }
    else if (roleCount < minTarget) {
        need = 'HIGH';
    }
    else if (roleCount <= idealTarget) {
        need = 'NORMAL';
    }
    else if (roleCount <= idealTarget + 2) {
        need = 'LOW';
    }
    else {
        need = 'REDUNDANT';
    }
    return { need: need };
}
// ============================================================
// SCARCITY ENGINE (Audit #10)
// Deep role + overseas scarcity with quality awareness
// ============================================================
// ============================================================
// AUCTION STAGE ENGINE (Audit #11)
// Purse-pacing advisor — NOT scripted phases
// ============================================================
// ============================================================
// OPPORTUNITY COST ENGINE (Audit #12, #84)
// "If I spend ₹14 Cr here, can I still fill my bowling gap?"
// Uses ONLY legitimate visible metadata (no hidden future stats)
// ============================================================
// ============================================================
// STRATEGIC IMPERFECTION ENGINE (Audit #60, #61)
// Rare legal bounded mistakes — rational-but-suboptimal choices
// Target: ~5-8% of eligible decisions
// ============================================================
// ============================================================
// INFORMATION FIREWALL (Audit #83)
// ============================================================
//
// STRUCTURAL GUARANTEE: Bot knowledge boundaries
//
// The bot sees ONLY:
// 1. Current player on auction block — full public stats (V3Player)
// 2. All teams' purse, roster, overseas count — public state (V3Team[])
// 3. PENDING lots' role, category, base_price, is_overseas — public queue
//    via FuturePlayer[] which contains NO stats, NO rating
// 4. Its own personality and computed valuation — internal derivation
//
// The bot NEVER sees:
// - Player stats of future players (only role/category/price)
// - Hidden player sets or unloaded data
// - Exact opponent bot valuations or decisions
// - Future lot ordering beyond what's in the public queue
//
// Future quality is estimated ONLY from category metadata:
//   MARQUEE/ICON → est ~88, A/ELITE → est ~85, B/PREMIER → est ~82,
//   C/CORE → est ~79, D/RISING → est ~76
// This is legitimate because category is publicly visible in the queue.
function estimateQualityFromCategory(category) {
    var cat = (category || '').toUpperCase();
    if (cat === 'MARQUEE' || cat === 'ICON')
        return 88;
    if (cat === 'A' || cat === 'ELITE')
        return 85;
    if (cat === 'B' || cat === 'PREMIER')
        return 82;
    if (cat === 'C' || cat === 'CORE')
        return 79;
    if (cat === 'D' || cat === 'RISING')
        return 76;
    return 78;
}
// Helper to compute enriched future pool analysis from FuturePlayer[]
function computeFutureQualityMap(futurePlayers) {
    var map = {};
    for (var _i = 0, futurePlayers_1 = futurePlayers; _i < futurePlayers_1.length; _i++) {
        var fp = futurePlayers_1[_i];
        if (!map[fp.role])
            map[fp.role] = { count: 0, totalEst: 0 };
        var entry = map[fp.role];
        if (entry) {
            entry.count++;
            entry.totalEst += estimateQualityFromCategory(fp.category);
        }
    }
    var result = {};
    for (var _a = 0, _b = Object.entries(map); _a < _b.length; _a++) {
        var _c = _b[_a], role = _c[0], data = _c[1];
        result[role] = {
            count: data.count,
            avgEstRating: data.count > 0 ? data.totalEst / data.count : 78,
        };
    }
    return result;
}
function computeFutureOverseasByRole(futurePlayers) {
    var result = {};
    for (var _i = 0, futurePlayers_2 = futurePlayers; _i < futurePlayers_2.length; _i++) {
        var fp = futurePlayers_2[_i];
        if (fp.is_overseas) {
            result[fp.role] = (result[fp.role] || 0) + 1;
        }
    }
    return result;
}
// ============================================================
// BOT ENGINE CORE LOOP
// This executes for EVERY single bid placed.
// Continuous re-evaluation: every price change triggers fresh evaluation.
// ============================================================
function evaluateBotsForLot(botTeams, player, currentBid, basePrice, highestBidderTeamId, botDifficulty, allTeams, teamRosters, ctx, timerExpiresAt, evidenceArr, passedAuctionId) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    var nextBidAmount = getNextBidAmount(currentBid, basePrice);
    var validBids = [];
    var highestBidder = allTeams.find(function (t) { return t.id === highestBidderTeamId; });
    var remainingTimerMs = timerExpiresAt ? new Date(timerExpiresAt).getTime() - Date.now() : 15000;
    for (var _i = 0, botTeams_1 = botTeams; _i < botTeams_1.length; _i++) {
        var bot = botTeams_1[_i];
        if (bot.id === highestBidderTeamId) {
            console.error(JSON.stringify({ logType: 'TACTICAL_EVAL_PROOF', botId: bot.id, decision: 'REJECTED_ELIGIBILITY', reason: 'ALREADY_HIGHEST_BIDDER', purse: bot.purse, currentBid: currentBid }));
            if (evidenceArr)
                evidenceArr.push({ teamId: bot.id, decision: 'REJECTED_ELIGIBILITY', valuation: 0, tv: 0, eligibilityReason: 'ALREADY_HIGHEST_BIDDER' });
            continue;
        }
        if (bot.purse < nextBidAmount) {
            console.error(JSON.stringify({ logType: 'TACTICAL_EVAL_PROOF', botId: bot.id, decision: 'REJECTED_ELIGIBILITY', reason: 'PURSE_INSUFFICIENT', purse: bot.purse, currentBid: currentBid }));
            if (evidenceArr)
                evidenceArr.push({ teamId: bot.id, decision: 'REJECTED_ELIGIBILITY', valuation: 0, tv: 0, eligibilityReason: 'PURSE_INSUFFICIENT' });
            continue;
        }
        if (bot.players_bought >= ctx.maxSquadSize) {
            console.error(JSON.stringify({ logType: 'TACTICAL_EVAL_PROOF', botId: bot.id, decision: 'REJECTED_ELIGIBILITY', reason: 'SQUAD_FULL', purse: bot.purse, currentBid: currentBid }));
            if (evidenceArr)
                evidenceArr.push({ teamId: bot.id, decision: 'REJECTED_ELIGIBILITY', valuation: 0, tv: 0, eligibilityReason: 'SQUAD_FULL' });
            continue;
        }
        if (bot.id === '4122f2b6-39f2-4ae1-b587-d4d2be6d0b92' || true) {
            console.error("[OVERSEAS DEBUG] Bot: ".concat(bot.id, ", player.is_overseas: ").concat(player === null || player === void 0 ? void 0 : player.is_overseas, ", bot.overseas_count: ").concat(bot.overseas_count, ", ctx.maxOverseas: ").concat(ctx.maxOverseas));
        }
        if ((player === null || player === void 0 ? void 0 : player.is_overseas) && bot.overseas_count >= ctx.maxOverseas) {
            console.error(JSON.stringify({ logType: 'TACTICAL_EVAL_PROOF', botId: bot.id, decision: 'REJECTED_ELIGIBILITY', reason: 'OVERSEAS_FULL', purse: bot.purse, currentBid: currentBid }));
            if (evidenceArr)
                evidenceArr.push({ teamId: bot.id, decision: 'REJECTED_ELIGIBILITY', valuation: 0, tv: 0, eligibilityReason: 'OVERSEAS_FULL' });
            continue;
        }
        var roster = teamRosters[bot.id] || [];
        var botIntelligence = undefined;
        var strategicPolicy = null;
        try {
            botIntelligence = (0, bot_intelligence_orchestrator_1.getBotIntelligenceContext)({
                team: bot,
                roster: roster,
                maxSquadSize: ctx.maxSquadSize,
                maxOverseas: ctx.maxOverseas
            });
            var candidateAlignment = (0, bot_candidate_alignment_1.computeCandidateAlignment)({
                candidateRole: player.role,
                targetState: botIntelligence.squadTargetState,
                alternativeState: botIntelligence.squadAlternativeState
            });
            strategicPolicy = (0, bot_strategic_adapter_1.buildStrategicDecisionPolicy)(player.role, botIntelligence, candidateAlignment);
        }
        catch (e) {
            strategicPolicy = (0, bot_strategic_adapter_1.buildStrategicDecisionPolicy)(player.role, null, null);
        }
        var personality = bot.personality || getBotPersonality(bot.id);
        var roleCount = roster.filter(function (p) { return p.role === player.role; }).length;
        var remainingSlots = Math.max(0, ctx.maxSquadSize - bot.players_bought);
        var roleNeed = getRoleNeed(player.role, roleCount, remainingSlots, ctx.maxSquadSize).need;
        if (strategicPolicy && !strategicPolicy.isFallback) {
            switch (strategicPolicy.pursuitStance) {
                case 'CRITICAL_PURSUIT':
                    roleNeed = 'CRITICAL';
                    break;
                case 'STRONG_PURSUIT':
                    roleNeed = 'HIGH';
                    break;
                case 'OPPORTUNISTIC_PURSUIT':
                    roleNeed = 'NORMAL';
                    break;
                case 'CONTINGENCY_PURSUIT':
                    roleNeed = 'NORMAL';
                    break;
                case 'WEAK_PURSUIT':
                    roleNeed = 'LOW';
                    break;
                case 'ABANDON_PREFERENCE':
                    roleNeed = 'REDUNDANT';
                    break;
            }
        }
        var auctionId = passedAuctionId || player.auction_id || 'AUCTION';
        // -------------------------------------------------------------
        // AUTHORITATIVE HUMAN AUCTION MANAGER PIPELINE (PHASES 3 -> 7)
        // -------------------------------------------------------------
        // 1. Phase 3: Player Quality + Market Value
        var playerQualityCtx = (0, human_auction_manager_context_1.assemblePlayerQualityContext)(player);
        var playerQualityResult = (0, human_auction_manager_context_1.assemblePlayerQualityResult)(playerQualityCtx);
        var marketValueCtx = (0, human_auction_manager_context_1.assembleMarketValueContext)({
            player: player,
            quality: playerQualityResult,
            auctionCtx: ctx
        });
        var marketValueResult = (0, human_auction_market_value_1.evaluatePlayerMarketValue)(marketValueCtx, player);
        // If player does not have an explicit rating, resolve it from the Phase 3 quality result
        var resolvedPlayer = player.rating != null
            ? player
            : __assign(__assign({}, player), { rating: playerQualityResult.rating });
        var playerCtx = (0, human_auction_manager_context_1.assemblePlayerContext)(resolvedPlayer);
        // 2. Phase 4: Team Value + Strategic Commitment
        var teamNeedCtx = (0, human_auction_manager_context_1.assembleTeamNeedContext)({
            playerRole: player.role,
            roster: roster,
            maxSquadSize: ctx.maxSquadSize,
            botIntelligence: botIntelligence
        });
        var xiImprovementCtx = (0, human_auction_manager_context_1.assembleXIImprovementContext)(playerQualityResult);
        var scarcityCtx = (0, human_auction_manager_context_1.assemblePlayerScarcityContext)({
            playerRole: player.role,
            auctionCtx: ctx,
            botIntelligence: botIntelligence
        });
        var teamFitCtx = (0, human_auction_manager_context_1.assembleTeamFitContext)({
            playerRole: player.role,
            botIntelligence: botIntelligence
        });
        var futurePlanCtx = (0, human_auction_manager_context_1.assembleFuturePlanContext)({
            maxSquadSize: ctx.maxSquadSize,
            roster: roster,
            botIntelligence: botIntelligence
        });
        var teamValueCtx = (0, human_auction_manager_context_1.assembleTeamValueContext)({
            player: playerCtx,
            marketValueResult: marketValueResult,
            teamNeed: teamNeedCtx,
            xiImprovement: xiImprovementCtx,
            scarcity: scarcityCtx,
            teamFit: teamFitCtx,
            futurePlan: futurePlanCtx,
            teamId: bot.id,
            currentRoster: roster
        });
        var teamValueResult = (0, human_auction_team_value_1.evaluateTeamValue)(teamValueCtx);
        // 3. Phase 5: Maximum Bid / Financial Ceiling
        var pursePosCtx = (0, human_auction_manager_context_1.assemblePursePositionContext)({
            team: bot,
            maxSquadSize: ctx.maxSquadSize
        });
        var auctionStage = (0, human_auction_manager_context_1.assembleAuctionStage)(ctx);
        var maxBidCtx = (0, human_auction_manager_context_1.assembleMaximumBidContext)({
            teamValue: teamValueResult,
            purse: pursePosCtx,
            auctionStage: auctionStage,
            currentBid: currentBid,
            nextRequiredBid: nextBidAmount,
            futureBudget: futurePlanCtx.protectedFutureBudget
        });
        var maxBidResult = (0, human_auction_maximum_bid_1.evaluateMaximumBid)(maxBidCtx);
        // 4. Phase 6: Opponent + Decision Context
        var opponentCtx = (0, human_auction_manager_context_1.assembleOpponentContext)({
            allTeams: allTeams,
            teamRosters: teamRosters,
            highestBidderTeamId: highestBidderTeamId,
            candidatePlayer: playerCtx,
            currentBid: currentBid,
            nextRequiredBid: nextBidAmount,
            maxSquadSize: ctx.maxSquadSize,
            myTeamId: bot.id
        });
        var decisionCtx = (0, human_auction_manager_context_1.assembleDecisionContext)({
            player: playerCtx,
            marketValue: marketValueResult,
            teamValue: teamValueResult,
            maximumBid: maxBidResult,
            opponent: opponentCtx,
            currentBid: currentBid,
            nextRequiredBid: nextBidAmount,
            auctionStage: auctionStage
        });
        // 5. Phase 7A: Price Position
        var pricePosCtx = (0, human_auction_decision_1.derivePricePositionContext)(decisionCtx);
        var pricePosResult = (0, human_auction_decision_1.evaluatePricePosition)(pricePosCtx);
        // 6. Phase 7: Sole Strategic Action Authority
        var humanDecision = (0, human_auction_decision_1.evaluateDecision)(decisionCtx);
        // Rival observation memory recording
        if (highestBidderTeamId && highestBidderTeamId !== bot.id && currentBid > 0) {
            (0, bot_brain_memory_1.recordRivalBidObservation)(auctionId, bot.id, player.id, highestBidderTeamId, currentBid);
        }
        var brainState = (_d = (_c = (_b = (_a = ctx === null || ctx === void 0 ? void 0 : ctx.brainStates) === null || _a === void 0 ? void 0 : _a[bot.id]) !== null && _b !== void 0 ? _b : ctx === null || ctx === void 0 ? void 0 : ctx.brainState) !== null && _c !== void 0 ? _c : (0, bot_brain_state_1.getBotBrainState)(auctionId, bot.id)) !== null && _d !== void 0 ? _d : null;
        // Optional legacy context / diagnostics evaluation (zero authority to override Phase 7)
        var tactical = null;
        var qResult = null;
        try {
            qResult = (0, bot_q_engine_1.evaluateQAndTV)(player, ctx.futurePlayers || [], {
                purse: bot.purse,
                playersBought: bot.players_bought,
                overseasCount: bot.overseas_count,
                roleCounts: roster.reduce(function (acc, p) {
                    acc[p.role] = (acc[p.role] || 0) + 1;
                    return acc;
                }, {})
            }, currentBid, false, { maxSquadSize: ctx.maxSquadSize, maxOverseas: ctx.maxOverseas });
            tactical = (0, bot_tactical_engine_1.evaluateTacticalDecision)({
                teamId: bot.id,
                auctionId: auctionId,
                lotId: player.id,
                personality: personality,
                qResult: qResult,
                roleNeed: roleNeed,
                strategicPolicy: strategicPolicy,
                brainState: brainState,
                basePrice: basePrice,
                remainingSlots: remainingSlots,
                purse: bot.purse,
                remainingTimerMs: remainingTimerMs,
                initialPurse: bot.initial_purse,
                auctionProgress: ctx.auctionProgress,
                futurePoolCount: (ctx.futurePlayers || []).length,
                maxSquadSize: ctx.maxSquadSize
            });
        }
        catch (e) {
            // Diagnostic failure must not disrupt authoritative execution
        }
        // -------------------------------------------------------------
        // RUNTIME ACTION ADAPTER
        // Maps Phase 7 HumanAuctionDecision directly to runtime execution.
        // -------------------------------------------------------------
        var decision = 'DROP';
        var delayMs = 0;
        if (humanDecision.action === 'BID') {
            decision = 'ENTER';
            var seed = "".concat(auctionId, "_").concat(player.id, "_").concat(bot.id, "_").concat(nextBidAmount, "_").concat(currentBid);
            var prng = (0, bot_tactical_engine_1.getDeterministicPseudoRandom)(seed);
            delayMs = (0, bot_tactical_engine_1.computeReactionDelay)(personality, teamNeedCtx.level, remainingTimerMs, prng, (_f = (_e = brainState === null || brainState === void 0 ? void 0 : brainState.plan) === null || _e === void 0 ? void 0 : _e.urgency) !== null && _f !== void 0 ? _f : 0);
            validBids.push({
                teamId: bot.id,
                nextBidAmount: humanDecision.bidAmount,
                delayMs: delayMs
            });
            (0, bot_brain_memory_1.recordBotBidObservation)(auctionId, bot.id, player.id, humanDecision.bidAmount, false);
        }
        else if (humanDecision.action === 'STRETCH') {
            decision = 'ONE_LAST_BID';
            delayMs = Math.min(Math.max(1500, Math.floor(3000 * (1 - ((_h = (_g = brainState === null || brainState === void 0 ? void 0 : brainState.plan) === null || _g === void 0 ? void 0 : _g.urgency) !== null && _h !== void 0 ? _h : 0)))), Math.max(500, remainingTimerMs - 400));
            validBids.push({
                teamId: bot.id,
                nextBidAmount: humanDecision.bidAmount,
                delayMs: delayMs
            });
            (0, bot_brain_memory_1.recordBotBidObservation)(auctionId, bot.id, player.id, humanDecision.bidAmount, true);
            if ((_j = brainState === null || brainState === void 0 ? void 0 : brainState.memory) === null || _j === void 0 ? void 0 : _j.observedBids) {
                brainState.memory.observedBids[player.id] = {
                    highestBid: humanDecision.bidAmount,
                    observedAt: Date.now(),
                    isFinalBid: true,
                };
            }
        }
        else {
            // humanDecision.action === 'PASS'
            decision = 'DROP';
            delayMs = 0;
        }
        // Determine primary diagnostic action reason:
        // If tactical engine ran and its action agrees with Phase 7, preserve tactical reason for legacy compatibility.
        // Otherwise, authoritative Phase 7 reason explains the decision.
        var actionReason = (_k = ((tactical === null || tactical === void 0 ? void 0 : tactical.action) === humanDecision.action ? tactical === null || tactical === void 0 ? void 0 : tactical.reason : undefined)) !== null && _k !== void 0 ? _k : humanDecision.reason;
        if (evidenceArr) {
            evidenceArr.push({
                teamId: bot.id,
                decision: decision,
                valuation: teamValueResult.teamValue,
                tv: teamValueResult.teamValue,
                actionReason: actionReason,
                pacingState: tactical === null || tactical === void 0 ? void 0 : tactical.pacingState,
                playerId: player.id,
                playerName: player.name,
                marketValue: marketValueResult.marketValue,
                teamValue: teamValueResult.teamValue,
                strategicCommitment: teamValueResult.strategicCommitment,
                maximumBid: maxBidResult.maximumBid,
                bindingConstraint: maxBidResult.bindingConstraint,
                currentBid: currentBid,
                nextRequiredBid: nextBidAmount,
                pricePosition: pricePosResult.state,
                auctionStage: auctionStage,
                finalAction: humanDecision.action,
                bidAmount: humanDecision.action !== 'PASS' ? humanDecision.bidAmount : 0,
                reasons: [humanDecision.reason],
                humanDecision: humanDecision
            });
        }
        var logObj = {
            logType: 'HUMAN_AUCTION_DECISION_PROOF',
            auctionId: auctionId,
            lotId: player.id,
            botId: bot.id,
            role: player.role,
            roleNeed: teamNeedCtx.level,
            futurePlayersCount: (ctx.futurePlayers || []).length,
            remainingSlots: remainingSlots,
            purse: bot.purse,
            currentBid: currentBid,
            nextRequiredBid: nextBidAmount,
            marketValue: marketValueResult.marketValue,
            teamValue: teamValueResult.teamValue,
            strategicCommitment: teamValueResult.strategicCommitment,
            maximumBid: maxBidResult.maximumBid,
            bindingConstraint: maxBidResult.bindingConstraint,
            pricePosition: pricePosResult.state,
            auctionStage: auctionStage,
            finalAction: humanDecision.action,
            bidAmount: humanDecision.action !== 'PASS' ? humanDecision.bidAmount : 0,
            decision: decision,
            reasons: [humanDecision.reason],
            delayMs: delayMs,
            remainingTimerMs: remainingTimerMs,
            brainStateAvailable: !!brainState
        };
        console.error(JSON.stringify(logObj));
        try {
            require('fs').appendFileSync('C:\\Users\\Palasanilavanya\\Mega-Auction-V3\\scratch\\human_auction_eval_proofs.jsonl', JSON.stringify(logObj) + '\n');
        }
        catch (e) { }
    }
    return validBids;
}
