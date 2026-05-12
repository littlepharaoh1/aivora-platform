/**
 * usePermissions.ts — Open access mode
 */
import { useAuth } from "./AuthContext";
import type { AivoraModule, AivoraRole } from "./permissions";
import { ROLE_MAP } from "./adminAllowlist";

export function usePermissions() {
  const { user } = useAuth();
  const role = (ROLE_MAP[user?.email?.toLowerCase() ?? ""] ?? "client_viewer") as AivoraRole;

  return {
    role,
    can:         (_module: AivoraModule) => true,  // Open access
    allowedTabs: [] as AivoraModule[],
    isOwner:     role === "owner",
    isAdmin:     role === "owner" || role === "admin",
    isQA:        ["owner","admin","qa_manager","qa_reviewer"].includes(role),
    isManager:   ["owner","admin","manager"].includes(role),
  };
}
