// ---------------------------------------------------------------------------
// Orchestrator — custom state-machine pipeline for the 3-agent review.
//
// Pipeline:
//   contextAgent()          — maps MR intent and risk hypotheses
//     ↓
//   investigatorLoop()      — tool-calling investigation loop
//     ↓
//   reflectionAgent()       — filters noise and verdicts
//     ↓ (if needsReinvestigation, max 1 re-run)
//   investigatorLoop()      — targeted re-investigation
//     ↓
//   reflectionAgent()       — final reflection pass
//     ↓
//   return ReviewState
// ---------------------------------------------------------------------------

import { getLogger } from "../logger";
import { contextAgent } from "./context-agent";
import { investigatorLoop } from "./investigator-agent";
import { reflectionAgent } from "./reflection-agent";
import type { ReviewState } from "./state";

const logger = getLogger(["gandalf", "orchestrator"]);

/**
 * Run the full 3-agent review pipeline and return the final ReviewState.
 *
 * @param initialState - A ReviewState with mrDetails, diffFiles, and repoPath
 *                       populated. All output fields will be filled in by this
 *                       function.
 */
export async function runReview(initialState: ReviewState): Promise<ReviewState> {
  logger.info("Starting review pipeline");

  // Stage 1: Context & Intent
  logger.info("Running Agent 1: Context & Intent");
  let state = await contextAgent(initialState);

  // Stage 2: Socratic Investigation (tool loop)
  logger.info("Running Agent 2: Socratic Investigation");
  state = await investigatorLoop(state);

  // Stage 3: Reflection & Consolidation
  logger.info("Running Agent 3: Reflection & Consolidation");
  state = await reflectionAgent(state);

  // Optional re-investigation loop (max 1 round trip)
  if (state.needsReinvestigation && state.reinvestigationCount < 1) {
    logger.info("Re-investigation requested — looping back to Agent 2");
    state = { ...state, reinvestigationCount: state.reinvestigationCount + 1 };
    state = await investigatorLoop(state);
    state = await reflectionAgent(state);
  }

  logger.info("Review complete", { verdict: state.summaryVerdict, findings: state.verifiedFindings.length });
  return state;
}
