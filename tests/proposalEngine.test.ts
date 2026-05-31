/**
 * proposalEngine.test.ts
 * AI Annotation proposal decoders — pure, deterministic.
 */

import { describe, it, expect } from "vitest";
import {
  decodeYOLO, decodeCLIP, decodeSAM2Mask,
  nonMaxSuppression, softmax, proposalsChecksum,
} from "../src/lib/aiAnnotation/proposalEngine";
import type { Proposal } from "../src/lib/aiAnnotation/aiAnnotationTypes";
import { confidenceBand, computeEffortMetrics } from "../src/lib/aiAnnotation/aiAnnotationTypes";
import type { ApprovalItem } from "../src/lib/aiAnnotation/aiAnnotationTypes";

// ── softmax ───────────────────────────────────────────────────────────────────

describe("softmax", () => {
  it("sums to 1", () => {
    const out = softmax([1,2,3,4]);
    expect(out.reduce((s,v)=>s+v,0)).toBeCloseTo(1);
  });
  it("largest logit → largest probability", () => {
    const out = softmax([1,5,2]);
    expect(out[1]).toBeGreaterThan(out[0]);
    expect(out[1]).toBeGreaterThan(out[2]);
  });
  it("handles empty", () => {
    expect(softmax([])).toEqual([]);
  });
  it("is numerically stable for large logits", () => {
    const out = softmax([1000,1001,1002]);
    expect(out.every(v=>isFinite(v))).toBe(true);
    expect(out.reduce((s,v)=>s+v,0)).toBeCloseTo(1);
  });
  it("is deterministic", () => {
    expect(softmax([1,2,3])).toEqual(softmax([1,2,3]));
  });
});

// ── decodeYOLO ────────────────────────────────────────────────────────────────

const yoloCfg = { imgW:640, imgH:640, classNames:["person","car","dog"], confThreshold:0.25, iouThreshold:0.45 };

describe("decodeYOLO", () => {
  it("decodes a confident detection", () => {
    // center (320,320), 100x100 box, class 0 = 0.9
    const rows = [[320,320,100,100, 0.9,0.1,0.1]];
    const out = decodeYOLO(rows, yoloCfg);
    expect(out).toHaveLength(1);
    expect(out[0].class_name).toBe("person");
    expect(out[0].confidence).toBeCloseTo(0.9);
    expect(out[0].kind).toBe("bbox");
  });

  it("normalizes bbox to 0..1", () => {
    const rows = [[320,320,100,100, 0.9,0,0]];
    const b = decodeYOLO(rows, yoloCfg)[0].bbox!;
    expect(b.x).toBeCloseTo((320-50)/640);
    expect(b.width).toBeCloseTo(100/640);
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x+b.width).toBeLessThanOrEqual(1);
  });

  it("filters below confidence threshold", () => {
    const rows = [[320,320,100,100, 0.1,0.1,0.1]];
    expect(decodeYOLO(rows, yoloCfg)).toHaveLength(0);
  });

  it("picks highest-scoring class", () => {
    const rows = [[320,320,100,100, 0.3,0.8,0.2]];
    expect(decodeYOLO(rows, yoloCfg)[0].class_name).toBe("car");
  });

  it("applies NMS to overlapping same-class boxes", () => {
    const rows = [
      [320,320,100,100, 0.9,0,0],
      [322,322,100,100, 0.7,0,0], // heavily overlapping, lower conf
    ];
    const out = decodeYOLO(rows, yoloCfg);
    expect(out).toHaveLength(1);
    expect(out[0].confidence).toBeCloseTo(0.9); // kept the higher
  });

  it("keeps non-overlapping boxes", () => {
    const rows = [
      [100,100,50,50, 0.9,0,0],
      [500,500,50,50, 0.8,0,0],
    ];
    expect(decodeYOLO(rows, yoloCfg)).toHaveLength(2);
  });

  it("is deterministic", () => {
    const rows = [[320,320,100,100,0.9,0,0],[100,100,40,40,0.6,0.7,0]];
    expect(decodeYOLO(rows,yoloCfg)).toEqual(decodeYOLO(rows,yoloCfg));
  });

  it("handles empty rows", () => {
    expect(decodeYOLO([], yoloCfg)).toEqual([]);
  });

  it("skips malformed rows", () => {
    const rows = [[1,2]]; // too short
    expect(decodeYOLO(rows, yoloCfg)).toHaveLength(0);
  });
});

// ── nonMaxSuppression ─────────────────────────────────────────────────────────

function bboxProp(id:string, conf:number, x:number, y:number, cls=0): Proposal {
  return { id, kind:"bbox", source:"yolo", class_id:cls, class_name:`c${cls}`,
    confidence:conf, bbox:{x,y,width:0.2,height:0.2}, mask_points:null, candidates:null };
}

describe("nonMaxSuppression", () => {
  it("removes overlapping lower-confidence same class", () => {
    const out = nonMaxSuppression([
      bboxProp("a",0.9,0.1,0.1), bboxProp("b",0.6,0.11,0.11),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("a");
  });

  it("keeps different classes even if overlapping", () => {
    const out = nonMaxSuppression([
      bboxProp("a",0.9,0.1,0.1,0), bboxProp("b",0.8,0.1,0.1,1),
    ]);
    expect(out).toHaveLength(2);
  });

  it("is order-independent (deterministic)", () => {
    const a = [bboxProp("a",0.9,0.1,0.1), bboxProp("b",0.6,0.11,0.11)];
    const r1 = nonMaxSuppression(a).map(p=>p.id);
    const r2 = nonMaxSuppression([...a].reverse()).map(p=>p.id);
    expect(r1).toEqual(r2);
  });

  it("passes through class proposals (no bbox)", () => {
    const classProp: Proposal = { id:"c", kind:"class", source:"clip", class_id:0,
      class_name:"x", confidence:0.9, bbox:null, mask_points:null, candidates:null };
    expect(nonMaxSuppression([classProp])).toHaveLength(1);
  });
});

// ── decodeCLIP ────────────────────────────────────────────────────────────────

describe("decodeCLIP", () => {
  it("ranks classes by probability", () => {
    const p = decodeCLIP([1,5,2], ["a","b","c"], 3);
    expect(p.class_name).toBe("b");
    expect(p.candidates![0].class_name).toBe("b");
    expect(p.kind).toBe("class");
  });

  it("limits to topK", () => {
    const p = decodeCLIP([1,2,3,4,5], ["a","b","c","d","e"], 2);
    expect(p.candidates).toHaveLength(2);
  });

  it("candidate scores sum-normalized (softmax)", () => {
    const p = decodeCLIP([1,1,1], ["a","b","c"], 3);
    const total = p.candidates!.reduce((s,c)=>s+c.score,0);
    expect(total).toBeCloseTo(1, 1);
  });

  it("is deterministic with stable tie-break", () => {
    const p1 = decodeCLIP([1,1], ["zebra","apple"], 2);
    const p2 = decodeCLIP([1,1], ["zebra","apple"], 2);
    expect(p1.candidates).toEqual(p2.candidates);
    // equal scores → alphabetical
    expect(p1.candidates![0].class_name).toBe("apple");
  });
});

// ── decodeSAM2Mask ────────────────────────────────────────────────────────────

describe("decodeSAM2Mask", () => {
  it("extracts polygon from mask extent", () => {
    // 4x4 mask, foreground in center 2x2
    const mask = [
      0,0,0,0,
      0,1,1,0,
      0,1,1,0,
      0,0,0,0,
    ];
    const p = decodeSAM2Mask(mask, 4, 4, 0, "obj", 0.9);
    expect(p.kind).toBe("mask");
    expect(p.mask_points).not.toBeNull();
    expect(p.mask_points!.length).toBe(4);
    expect(p.bbox).not.toBeNull();
  });

  it("handles empty mask", () => {
    const p = decodeSAM2Mask([0,0,0,0], 2, 2, 0, "obj", 0.5);
    expect(p.confidence).toBe(0);
    expect(p.mask_points).toEqual([]);
  });

  it("is deterministic", () => {
    const mask = [0,1,1,0,1,1,0,0,0];
    const p1 = decodeSAM2Mask(mask,3,3,0,"o",0.8);
    const p2 = decodeSAM2Mask(mask,3,3,0,"o",0.8);
    expect(p1).toEqual(p2);
  });
});

// ── proposalsChecksum ─────────────────────────────────────────────────────────

describe("proposalsChecksum", () => {
  it("is order-independent", () => {
    const a = bboxProp("a",0.9,0.1,0.1);
    const b = bboxProp("b",0.8,0.5,0.5);
    expect(proposalsChecksum([a,b])).toBe(proposalsChecksum([b,a]));
  });
  it("differs for different proposals", () => {
    const a = bboxProp("a",0.9,0.1,0.1);
    const b = bboxProp("b",0.8,0.5,0.5,1);
    expect(proposalsChecksum([a])).not.toBe(proposalsChecksum([b]));
  });
});

// ── confidenceBand + effort metrics ───────────────────────────────────────────

describe("confidenceBand", () => {
  it("classifies bands", () => {
    expect(confidenceBand(0.9)).toBe("high");
    expect(confidenceBand(0.6)).toBe("medium");
    expect(confidenceBand(0.3)).toBe("low");
  });
  it("boundary at 0.75 and 0.5", () => {
    expect(confidenceBand(0.75)).toBe("high");
    expect(confidenceBand(0.5)).toBe("medium");
    expect(confidenceBand(0.49)).toBe("low");
  });
});

describe("computeEffortMetrics", () => {
  function item(decision:ApprovalItem["decision"]):ApprovalItem {
    return { proposal: bboxProp("x",0.9,0.1,0.1), decision };
  }
  it("counts decisions and computes reduction", () => {
    const m = computeEffortMetrics([
      item("accepted"), item("accepted"), item("edited"), item("rejected"),
    ]);
    expect(m.accepted).toBe(2);
    expect(m.edited).toBe(1);
    expect(m.rejected).toBe(1);
    expect(m.effort_reduction).toBeCloseTo(0.75); // (2+1)/4 kept
  });
  it("60% reduction scenario", () => {
    const items = [
      ...Array(6).fill(0).map(()=>item("accepted")),
      ...Array(4).fill(0).map(()=>item("rejected")),
    ];
    const m = computeEffortMetrics(items);
    expect(m.effort_reduction).toBeCloseTo(0.6); // success criterion
  });
  it("handles empty", () => {
    expect(computeEffortMetrics([]).effort_reduction).toBe(0);
  });
});
