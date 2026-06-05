/**
 * useAIAnnotation.ts
 * Aivora Platform — AI Annotation Hook
 *
 * One-click auto-annotate + human approval workflow. Sits ALONGSIDE the manual
 * annotation flow — proposals only become annotations when the human accepts.
 * Reuses aiAnnotationService (which reuses onnxRuntime + modelRegistry).
 */

import { useState, useCallback, useMemo } from "react";
import { useAuth } from "../../hooks/useAuth";
import { autoAnnotate, modelStatus } from "./aiAnnotationService";
import { preprocessForYOLO } from "./imagePreprocess";
import {
  computeEffortMetrics, confidenceBand,
} from "./aiAnnotationTypes";
import type {
  AssistModel, Proposal, ApprovalItem, ApprovalDecision,
  AutoAnnotateResult, EffortMetrics,
} from "./aiAnnotationTypes";

export interface UseAIAnnotationParams {
  asset_id:   string;
  asset_type: "image" | "video_frame";
  imgW:       number;
  imgH:       number;
}

export function useAIAnnotation(params: UseAIAnnotationParams) {
  const { user } = useAuth();

  const [items,      setItems]      = useState<ApprovalItem[]>([]);
  const [running,    setRunning]    = useState(false);
  const [lastResult, setLastResult] = useState<AutoAnnotateResult | null>(null);
  const [minConfidence, setMinConfidence] = useState(0.5);
  const [statusMsg,  setStatusMsg]  = useState("");

  // ── Availability of each model (for UI badges) ──────────────────────────────
  const availability = useMemo(() => ({
    yolo:           modelStatus("yolo"),
    sam2:           modelStatus("sam2"),
    grounding_dino: modelStatus("grounding_dino"),
    clip:           modelStatus("clip"),
  }), []);

  // ── One-click auto-annotate ─────────────────────────────────────────────────
  const runAutoAnnotate = useCallback(async (
    model: AssistModel,
    imageSource: CanvasImageSource | null,
    textLabels: string[] = [],
  ) => {
    setRunning(true);
    setStatusMsg(`Running ${model.toUpperCase()}…`);
    try {
      // Build the input tensor from the image (deterministic letterbox + normalize)
      const preprocess = imageSource
        ? preprocessForYOLO(imageSource, params.imgW, params.imgH)
        : null;

      const result = await autoAnnotate({
        model,
        asset_id:    params.asset_id,
        asset_type:  params.asset_type,
        imgW:        params.imgW,
        imgH:        params.imgH,
        preprocess,
        textLabels,
        user_id:     user?.id ?? null,
      });
      setLastResult(result);
      setStatusMsg(result.message);

      // Seed approval items from proposals (all pending)
      const newItems: ApprovalItem[] = result.proposals.map(p => ({
        proposal: p, decision: "pending" as ApprovalDecision,
      }));
      setItems(newItems);
      return result;
    } finally {
      setRunning(false);
    }
  }, [params, user]);

  // ── Approval actions ────────────────────────────────────────────────────────
  const decide = useCallback((proposalId: string, decision: ApprovalDecision) => {
    setItems(prev => prev.map(it =>
      it.proposal.id === proposalId ? { ...it, decision } : it
    ));
  }, []);

  const acceptAll = useCallback(() => {
    setItems(prev => prev.map(it =>
      it.decision === "pending" && it.proposal.confidence >= minConfidence
        ? { ...it, decision: "accepted" }
        : it
    ));
  }, [minConfidence]);

  const rejectAll = useCallback(() => {
    setItems(prev => prev.map(it =>
      it.decision === "pending" ? { ...it, decision: "rejected" } : it
    ));
  }, []);

  const clearProposals = useCallback(() => {
    setItems([]);
    setLastResult(null);
    setStatusMsg("");
  }, []);

  // ── Derived ─────────────────────────────────────────────────────────────────
  // Proposals visible at the current confidence threshold
  const visibleItems = useMemo(
    () => items.filter(it => it.proposal.confidence >= minConfidence),
    [items, minConfidence],
  );

  // Accepted proposals → ready to convert into real annotations
  const acceptedProposals = useMemo(
    () => items.filter(it => it.decision === "accepted").map(it => it.proposal),
    [items],
  );

  const effort: EffortMetrics = useMemo(
    () => computeEffortMetrics(items),
    [items],
  );

  const pendingCount = useMemo(
    () => items.filter(it => it.decision === "pending").length,
    [items],
  );

  return {
    // state
    items, visibleItems, running, lastResult, statusMsg,
    minConfidence, setMinConfidence,
    availability,
    // derived
    acceptedProposals, effort, pendingCount,
    // actions
    runAutoAnnotate, decide, acceptAll, rejectAll, clearProposals,
    // helper re-export
    confidenceBand,
  };
}
