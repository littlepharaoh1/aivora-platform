export const colors = {
  bg: {
    base:     "#080F1A",
    surface:  "#0D1826",
    elevated: "#111F30",
    overlay:  "#162438",
    border:   "#1A3045",
    borderSub:"#0F2030",
  },
  accent: {
    sky:       "#0EA5E9",
    skyDim:    "#0EA5E922",
    skyBorder: "#0EA5E944",
    purple:    "#8B5CF6",
    purpleDim: "#8B5CF622",
    green:     "#10B981",
    greenDim:  "#10B98122",
    amber:     "#F59E0B",
    amberDim:  "#F59E0B22",
    red:       "#EF4444",
    redDim:    "#EF444422",
    cyan:      "#22D3EE",
    cyanDim:   "#22D3EE22",
  },
  text: {
    primary:   "#E2EEF6",
    secondary: "#64A0B8",
    muted:     "#2A5A6A",
    disabled:  "#1A3A4A",
  },
} as const;

export const fonts = {
  ui:   "'Inter', 'Segoe UI', system-ui, sans-serif",
  mono: "'JetBrains Mono', 'Fira Code', monospace",
} as const;

export const radius = { sm:4, md:8, lg:12, xl:16 } as const;
export const spacing = { xs:4, sm:8, md:12, lg:16, xl:24 } as const;
