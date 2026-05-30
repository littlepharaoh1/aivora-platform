/**
 * enterpriseAnnotation.test.ts
 * Aivora Platform — Enterprise Annotation Tests
 */

import { describe, it, expect } from "vitest";
import {
  createEnterpriseState,
  addAnnotation, updateAnnotation, deleteAnnotations,
  undoState, redoState,
  normalizeBBox, isBBoxValid, clampPoint,
  snapPoint, bboxFromPoints,
  addLayer, toggleLayerVisibility, setActiveLayer,
  selectAnnotations, duplicateAnnotations,
  setQAFlag, hitTestAnnotation, hitTestAll,
  createAnnotation,
} from "../src/annotation/enterpriseAnnotationState";
import { computeStats } from "../src/annotation/annotationExportService";
import type { EnterpriseAnnotation } from "../src/annotation/annotationTypes";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeState() {
  return createEnterpriseState("test-image-001");
}

function makeAnn(overrides: Partial<EnterpriseAnnotation> = {}): EnterpriseAnnotation {
  return createAnnotation({
    type:        "bbox",
    class_id:    1,
    class_name:  "vehicle",
    class_color: "#ef4444",
    layer_id:    "layer_default",
    image_id:    "test-image-001",
    sequence:    0,
    bbox:        { x:0.1, y:0.1, width:0.3, height:0.2 },
    ...overrides,
  });
}

// ── State factory ─────────────────────────────────────────────────────────────

describe("createEnterpriseState", () => {
  it("creates valid initial state", () => {
    const s = makeState();
    expect(s.annotations).toHaveLength(0);
    expect(s.layers).toHaveLength(1);
    expect(s.layers[0].id).toBe("layer_default");
    expect(s.history).toHaveLength(0);
    expect(s.future).toHaveLength(0);
    expect(s.sequence).toBe(0);
    expect(s.selected_ids).toHaveLength(0);
  });

  it("is deterministic — same imageId same structure", () => {
    const s1 = createEnterpriseState("img-abc");
    const s2 = createEnterpriseState("img-abc");
    expect(s1.image_id).toBe(s2.image_id);
    expect(s1.layers[0].name).toBe(s2.layers[0].name);
    expect(s1.version).toBe(s2.version);
  });
});

// ── Annotation CRUD ───────────────────────────────────────────────────────────

describe("addAnnotation", () => {
  it("adds annotation to state", () => {
    const s = addAnnotation(makeState(), makeAnn());
    expect(s.annotations).toHaveLength(1);
  });

  it("increments sequence", () => {
    const s = addAnnotation(makeState(), makeAnn());
    expect(s.sequence).toBe(1);
  });

  it("selects new annotation", () => {
    const ann = makeAnn();
    const s   = addAnnotation(makeState(), ann);
    expect(s.selected_ids).toContain(ann.id);
  });

  it("pushes to history", () => {
    const s = addAnnotation(makeState(), makeAnn());
    expect(s.history).toHaveLength(1);
  });

  it("clears future on add", () => {
    let s = addAnnotation(makeState(), makeAnn());
    s = undoState(s);
    s = addAnnotation(s, makeAnn());
    expect(s.future).toHaveLength(0);
  });

  it("respects MAX_ANNOTATIONS limit", () => {
    let s = makeState();
    for(let i=0; i<10_001; i++) s = addAnnotation(s, makeAnn());
    expect(s.annotations.length).toBeLessThanOrEqual(10_000);
  });
});

describe("updateAnnotation", () => {
  it("updates annotation field", () => {
    let s = addAnnotation(makeState(), makeAnn());
    const id = s.annotations[0].id;
    s = updateAnnotation(s, id, { notes: "test note" });
    expect(s.annotations[0].notes).toBe("test note");
  });

  it("pushes to history on update", () => {
    let s = addAnnotation(makeState(), makeAnn());
    const id = s.annotations[0].id;
    const histLen = s.history.length;
    s = updateAnnotation(s, id, { notes: "updated" });
    expect(s.history.length).toBeGreaterThan(histLen);
  });

  it("does not change other annotations", () => {
    let s = addAnnotation(makeState(), makeAnn());
    s = addAnnotation(s, makeAnn());
    const id = s.annotations[0].id;
    const other = s.annotations[1].id;
    s = updateAnnotation(s, id, { notes: "changed" });
    const otherAnn = s.annotations.find(a=>a.id===other);
    expect(otherAnn?.notes).toBe("");
  });
});

describe("deleteAnnotations", () => {
  it("removes annotation by id", () => {
    let s = addAnnotation(makeState(), makeAnn());
    const id = s.annotations[0].id;
    s = deleteAnnotations(s, [id]);
    expect(s.annotations).toHaveLength(0);
  });

  it("clears selected_ids after delete", () => {
    let s = addAnnotation(makeState(), makeAnn());
    const id = s.annotations[0].id;
    s = deleteAnnotations(s, [id]);
    expect(s.selected_ids).toHaveLength(0);
  });

  it("does nothing for empty ids", () => {
    let s = addAnnotation(makeState(), makeAnn());
    const before = s.annotations.length;
    s = deleteAnnotations(s, []);
    expect(s.annotations.length).toBe(before);
  });
});

// ── Undo / Redo ───────────────────────────────────────────────────────────────

describe("undoState / redoState", () => {
  it("undo restores previous state", () => {
    let s = addAnnotation(makeState(), makeAnn());
    s = undoState(s);
    expect(s.annotations).toHaveLength(0);
  });

  it("redo re-applies undone change", () => {
    let s = addAnnotation(makeState(), makeAnn());
    s = undoState(s);
    s = redoState(s);
    expect(s.annotations).toHaveLength(1);
  });

  it("undo does nothing on empty history", () => {
    const s = makeState();
    const s2 = undoState(s);
    expect(s2.annotations).toHaveLength(0);
    expect(s2.history).toHaveLength(0);
  });

  it("redo does nothing on empty future", () => {
    const s = makeState();
    const s2 = redoState(s);
    expect(s2.annotations).toHaveLength(0);
  });

  it("multiple undo/redo cycle is correct", () => {
    let s = makeState();
    s = addAnnotation(s, makeAnn());
    s = addAnnotation(s, makeAnn());
    expect(s.annotations).toHaveLength(2);
    s = undoState(s);
    expect(s.annotations).toHaveLength(1);
    s = undoState(s);
    expect(s.annotations).toHaveLength(0);
    s = redoState(s);
    expect(s.annotations).toHaveLength(1);
  });
});

// ── Geometry ──────────────────────────────────────────────────────────────────

describe("normalizeBBox", () => {
  it("normalizes negative width/height", () => {
    const b = normalizeBBox({ x:0.5, y:0.5, width:-0.2, height:-0.1 });
    expect(b.width).toBeGreaterThan(0);
    expect(b.height).toBeGreaterThan(0);
    expect(b.x).toBeLessThan(0.5);
    expect(b.y).toBeLessThan(0.5);
  });

  it("clamps to image bounds", () => {
    const b = normalizeBBox({ x:0.9, y:0.9, width:0.5, height:0.5 });
    expect(b.x + b.width).toBeLessThanOrEqual(1);
    expect(b.y + b.height).toBeLessThanOrEqual(1);
  });

  it("is deterministic", () => {
    const input = { x:0.3, y:0.2, width:0.4, height:0.3 };
    expect(normalizeBBox(input)).toEqual(normalizeBBox(input));
  });
});

describe("isBBoxValid", () => {
  it("returns true for valid bbox", () => {
    expect(isBBoxValid({ x:0.1, y:0.1, width:0.2, height:0.2 })).toBe(true);
  });

  it("returns false for too-small bbox", () => {
    expect(isBBoxValid({ x:0.1, y:0.1, width:0.001, height:0.001 })).toBe(false);
  });

  it("returns false for out-of-bounds bbox", () => {
    expect(isBBoxValid({ x:0.9, y:0.9, width:0.2, height:0.2 })).toBe(false);
  });
});

describe("clampPoint", () => {
  it("clamps point within 0→1", () => {
    expect(clampPoint({ x:-0.5, y:1.5 })).toEqual({ x:0, y:1 });
  });

  it("does not change valid point", () => {
    expect(clampPoint({ x:0.5, y:0.5 })).toEqual({ x:0.5, y:0.5 });
  });
});

describe("bboxFromPoints", () => {
  it("returns correct bbox from polygon", () => {
    const pts = [
      { x:0.1, y:0.2 }, { x:0.5, y:0.1 },
      { x:0.6, y:0.4 }, { x:0.2, y:0.5 },
    ];
    const b = bboxFromPoints(pts);
    expect(b).not.toBeNull();
    expect(b!.x).toBeCloseTo(0.1);
    expect(b!.y).toBeCloseTo(0.1);
    expect(b!.width).toBeCloseTo(0.5);
    expect(b!.height).toBeCloseTo(0.4);
  });

  it("returns null for < 2 points", () => {
    expect(bboxFromPoints([{x:0.1,y:0.1}])).toBeNull();
    expect(bboxFromPoints([])).toBeNull();
  });
});

// ── Layers ────────────────────────────────────────────────────────────────────

describe("Layer management", () => {
  it("adds a layer", () => {
    const s = addLayer(makeState(), "Vehicles");
    expect(s.layers).toHaveLength(2);
    expect(s.layers[1].name).toBe("Vehicles");
  });

  it("toggles layer visibility", () => {
    let s = makeState();
    const lid = s.layers[0].id;
    expect(s.layers[0].visible).toBe(true);
    s = toggleLayerVisibility(s, lid);
    expect(s.layers[0].visible).toBe(false);
    s = toggleLayerVisibility(s, lid);
    expect(s.layers[0].visible).toBe(true);
  });

  it("sets active layer", () => {
    let s = addLayer(makeState(), "Layer 2");
    const lid = s.layers[1].id;
    s = setActiveLayer(s, lid);
    expect(s.active_layer).toBe(lid);
  });
});

// ── Selection ─────────────────────────────────────────────────────────────────

describe("selectAnnotations", () => {
  it("selects by ids", () => {
    let s = addAnnotation(makeState(), makeAnn());
    const id = s.annotations[0].id;
    s = selectAnnotations(s, [id]);
    expect(s.selected_ids).toContain(id);
  });

  it("clears selection", () => {
    let s = addAnnotation(makeState(), makeAnn());
    const id = s.annotations[0].id;
    s = selectAnnotations(s, [id]);
    s = selectAnnotations(s, []);
    expect(s.selected_ids).toHaveLength(0);
  });
});

describe("duplicateAnnotations", () => {
  it("duplicates selected annotations", () => {
    let s = addAnnotation(makeState(), makeAnn());
    const id = s.annotations[0].id;
    s = selectAnnotations(s, [id]);
    s = duplicateAnnotations(s, [id]);
    expect(s.annotations).toHaveLength(2);
    expect(s.annotations[0].id).not.toBe(s.annotations[1].id);
  });

  it("offsets duplicated bbox", () => {
    let s = addAnnotation(makeState(), makeAnn());
    const orig = s.annotations[0];
    s = duplicateAnnotations(s, [orig.id]);
    const dup = s.annotations[1];
    expect(dup.bbox?.x).not.toBe(orig.bbox?.x);
  });
});

// ── QA Flags ──────────────────────────────────────────────────────────────────

describe("setQAFlag", () => {
  it("sets flag on annotation", () => {
    let s = addAnnotation(makeState(), makeAnn());
    const id = s.annotations[0].id;
    s = setQAFlag(s, id, "occluded");
    expect(s.annotations[0].qa_flag).toBe("occluded");
  });

  it("clears flag", () => {
    let s = addAnnotation(makeState(), makeAnn());
    const id = s.annotations[0].id;
    s = setQAFlag(s, id, "occluded");
    s = setQAFlag(s, id, null);
    expect(s.annotations[0].qa_flag).toBeNull();
  });
});

// ── Hit testing ───────────────────────────────────────────────────────────────

describe("hitTestAnnotation", () => {
  it("hits inside bbox", () => {
    const ann = makeAnn();
    expect(hitTestAnnotation(ann, 0.2, 0.2)).toBe(true);
  });

  it("misses outside bbox", () => {
    const ann = makeAnn();
    expect(hitTestAnnotation(ann, 0.9, 0.9)).toBe(false);
  });

  it("hits inside polygon", () => {
    const ann = makeAnn({
      type:   "polygon",
      bbox:   null,
      points: [
        {x:0.2,y:0.2},{x:0.4,y:0.2},
        {x:0.4,y:0.4},{x:0.2,y:0.4},
      ],
    });
    expect(hitTestAnnotation(ann, 0.3, 0.3)).toBe(true);
  });
});

describe("hitTestAll", () => {
  it("returns top annotation on overlap", () => {
    let s = addAnnotation(makeState(), makeAnn());
    s = addAnnotation(s, makeAnn({ class_name:"person", class_id:2 }));
    const hit = hitTestAll(s.annotations, 0.2, 0.2);
    expect(hit).not.toBeNull();
    // Last added = top
    expect(hit?.class_name).toBe("person");
  });

  it("returns null for no hit", () => {
    let s = addAnnotation(makeState(), makeAnn());
    const hit = hitTestAll(s.annotations, 0.99, 0.99);
    expect(hit).toBeNull();
  });
});

// ── Stats ─────────────────────────────────────────────────────────────────────

describe("computeStats", () => {
  it("returns correct counts", () => {
    let s = makeState();
    s = addAnnotation(s, makeAnn({ class_name:"car" }));
    s = addAnnotation(s, makeAnn({ class_name:"car" }));
    s = addAnnotation(s, makeAnn({ class_name:"person", class_id:2 }));
    const stats = computeStats(s.annotations);
    expect(stats.total).toBe(3);
    expect(stats.by_class["car"]).toBe(2);
    expect(stats.by_class["person"]).toBe(1);
  });

  it("handles empty annotations", () => {
    const stats = computeStats([]);
    expect(stats.total).toBe(0);
    expect(stats.mean_confidence).toBe(0);
  });
});
