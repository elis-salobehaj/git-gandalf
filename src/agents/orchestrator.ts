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

import { contextAgent } from "./context-agent";
import { investigatorLoop } from "./investigator-agent";
import { reflectionAgent } from "./reflection-agent";
import type { ReviewState } from "./state";

/**
 * Run the full 3-agent review pipeline and return the final ReviewState.
 *
 * @param initialState - A ReviewState with mrDetails, diffFiles, and repoPath
 *                       populated. All output fields will be filled in by this
 *                       function.
 */
export async function runReview(initialState: ReviewState): Promise<ReviewState> {
  console.log("[orchestrator] Starting review pipeline");

  // Stage 1: Context & Intent
  console.log("[orchestrator] Agent 1: Context & Intent");
  let state = await contextAgent(initialState);

  // Stage 2: Socratic Investigation (tool loop)
  console.log("[orchestrator] Agent 2: Socratic Investigation");
  state = await investigatorLoop(state);

  // Stage 3: Reflection & Consolidation
  console.log("[orchestrator] Agent 3: Reflection & Consolidation");
  state = await reflectionAgent(state);

  // Optional re-investigation loop (max 1 round trip)
  if (state.needsReinvestigation && state.reinvestigationCount < 1) {
    console.log("[orchestrator] Re-investigation requested — looping back to Agent 2");
    state = { ...state, reinvestigationCount: state.reinvestigationCount + 1 };
    state = await investigatorLoop(state);
    state = await reflectionAgent(state);
  }

  console.log(`[orchestrator] Review complete: ${state.summaryVerdict} (${state.verifiedFindings.length} findings)`);
  return state;
}
