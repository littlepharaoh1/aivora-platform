/**
 * usePermissions.ts — Permission hook
 */
import { useAuth } from "./AuthContext";
import { canAccess, getAllowedTabs } from "./permissions";
import type { AivoraModule, AivoraRole } from "./permissions";

export function usePermissions() {
  const { user } = useAuth();
  const role = (user?.role ?? "client_viewer") as AivoraRole;

  return {
    role,
    can:         (module: AivoraModule) => canAccess(role, module),
    allowedTabs: getAllowedTabs(role),
    isOwner:     role === "owner",
    isAdmin:     role === "owner" || role === "admin",
    isQA:        ["owner","admin","qa_manager","qa_reviewer"].includes(role),
    isManager:   ["owner","admin","manager"].includes(role),
  };
}
