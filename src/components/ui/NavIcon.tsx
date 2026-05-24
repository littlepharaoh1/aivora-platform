import { Mic, BarChart2, Tag, Wrench, Zap, CheckCircle, Search, SlidersHorizontal, Users, Activity, FlaskConical, ShoppingBag, Music, LayoutDashboard, MessageSquare, Home } from "lucide-react";
import React from "react";

export const NAV_ICON_MAP: Record<string, React.ElementType> = {
  dashboard:    LayoutDashboard,
  qc:           Mic,
  batch:        BarChart2,
  naming:       Tag,
  enhancement:  Wrench,
  pipeline:     Zap,
  delivery:     CheckCircle,
  forensic:     Search,
  audition:     SlidersHorizontal,
  contributors: Users,
  monitor:      Activity,
  dsp:          FlaskConical,
  store:        ShoppingBag,
  proeditor:    Music,
  rooms:        MessageSquare,
};

export const GROUP_COLORS: Record<string,string> = {
  production:  "#0EA5E9",
  repair:      "#8B5CF6",
  manage:      "#10B981",
  system:      "#F59E0B",
  enterprise:  "#22D3EE",
};

interface NavIconProps {
  name:   string;
  size?:  number;
  color?: string;
}

export default function NavIcon({ name, size=18, color="currentColor" }: NavIconProps) {
  const Icon = NAV_ICON_MAP[name] ?? Home;
  return <Icon size={size} strokeWidth={1.5} color={color}/>;
}
