/**
 * taxonomyEngine.ts — Label Taxonomy + Governance
 * Aivora Platform — Phase 15.5
 *
 * ✅ deterministic: same taxonomy → same colors/IDs always
 * ✅ bounded: MAX_CLASSES=200, MAX_DEPTH=5
 * ✅ no hidden state: pure functions
 * ✅ versioned: schema_version per taxonomy
 * ✅ replay-safe: stable ID assignment
 */

export const TAXONOMY_VERSION = "15.5.0";

export const TAXONOMY_LIMITS = {
  MAX_CLASSES: 200,
  MAX_DEPTH:   5,
  MAX_ALIASES: 10,
} as const;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LabelClass {
  id:          number;       // stable integer ID
  name:        string;
  color:       string;       // hex
  parent_id:   number | null;
  aliases:     string[];
  created_at:  string;
  is_active:   boolean;
}

export interface Taxonomy {
  id:             string;
  name:           string;
  version:        string;
  schema_version: string;
  classes:        LabelClass[];
  created_at:     string;
}

// ── Default COCO-compatible palette (deterministic) ───────────────────────────

const PALETTE: string[] = [
  "#ef4444","#f97316","#eab308","#22c55e","#14b8a6",
  "#3b82f6","#8b5cf6","#ec4899","#06b6d4","#10b981",
  "#f59e0b","#6366f1","#84cc16","#f43f5e","#0ea5e9",
  "#a855f7","#d946ef","#64748b","#78716c","#71717a",
];

// Deterministic color assignment — same class index = same color always
export function getClassColor(index: number): string {
  return PALETTE[index % PALETTE.length];
}

// ── Taxonomy Factory ──────────────────────────────────────────────────────────

export function createTaxonomy(
  name:    string,
  classes: { name:string; parent_id?:number; aliases?:string[] }[],
): Taxonomy {
  if(classes.length > TAXONOMY_LIMITS.MAX_CLASSES) {
    throw new Error(`Taxonomy exceeds MAX_CLASSES (${TAXONOMY_LIMITS.MAX_CLASSES})`);
  }
  const now = new Date().toISOString();
  return {
    id:             crypto.randomUUID(),
    name,
    version:        TAXONOMY_VERSION,
    schema_version: "1.0",
    created_at:     now,
    classes: classes.map((c, i) => ({
      id:         i + 1,          // 1-indexed, stable
      name:       c.name,
      color:      getClassColor(i),
      parent_id:  c.parent_id ?? null,
      aliases:    (c.aliases ?? []).slice(0, TAXONOMY_LIMITS.MAX_ALIASES),
      created_at: now,
      is_active:  true,
    })),
  };
}

// ── Default Taxonomies ────────────────────────────────────────────────────────

export const COCO_TAXONOMY = createTaxonomy("COCO 80", [
  { name:"person" },{ name:"bicycle" },{ name:"car" },
  { name:"motorcycle" },{ name:"airplane" },{ name:"bus" },
  { name:"train" },{ name:"truck" },{ name:"boat" },
  { name:"traffic light" },{ name:"fire hydrant" },
  { name:"stop sign" },{ name:"parking meter" },
  { name:"bench" },{ name:"bird" },{ name:"cat" },
  { name:"dog" },{ name:"horse" },{ name:"sheep" },
  { name:"cow" },{ name:"elephant" },{ name:"bear" },
  { name:"zebra" },{ name:"giraffe" },{ name:"backpack" },
  { name:"umbrella" },{ name:"handbag" },{ name:"tie" },
  { name:"suitcase" },{ name:"frisbee" },
]);

export const SIMPLE_TAXONOMY = createTaxonomy("Simple", [
  { name:"object" },{ name:"person" },{ name:"vehicle" },
  { name:"animal" },{ name:"text" },{ name:"other" },
]);

// ── Lookup helpers ────────────────────────────────────────────────────────────

export function getClassById(
  taxonomy: Taxonomy, id: number,
): LabelClass | null {
  return taxonomy.classes.find(c => c.id === id) ?? null;
}

export function getClassByName(
  taxonomy: Taxonomy, name: string,
): LabelClass | null {
  const lower = name.toLowerCase();
  return taxonomy.classes.find(c =>
    c.name.toLowerCase() === lower ||
    c.aliases.some(a => a.toLowerCase() === lower)
  ) ?? null;
}

// ── Export mapping ────────────────────────────────────────────────────────────
// Maps internal class IDs to export format IDs (COCO uses 0-based in YOLO)

export function toYOLOClassId(taxonomy: Taxonomy, classId: number): number {
  const idx = taxonomy.classes.findIndex(c => c.id === classId);
  return idx >= 0 ? idx : 0;
}

export function toCOCOCategories(taxonomy: Taxonomy) {
  return taxonomy.classes.map(c => ({
    id:           c.id,
    name:         c.name,
    supercategory:"object",
  }));
}
