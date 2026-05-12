/**
 * adminAllowlist.ts — Access Control
 * Aivora Platform
 */

export const OWNER_EMAILS: string[] = [
  "zikaaaa460@gmail.com",
];

export const ADMIN_EMAILS: string[] = [
  "zikaaaa460@gmail.com",
  "aivoraailtduk@gmail.com",
];

export const ROLE_MAP: Record<string, string> = {
  "zikaaaa460@gmail.com":    "owner",
  "aivoraailtduk@gmail.com": "admin",
  "aivoracontrol@gmail.com": "manager",
  "aivoraleader@gmail.com":  "manager",
  "aivoraqa@gmail.com":      "qa_manager",
};

// OPEN = any Google account can access
export const RESTRICT_ACCESS = false;

export function getRoleFromEmail(email: string): string {
  return ROLE_MAP[email.toLowerCase()] ?? "client_viewer";
}

export function isEmailAllowed(email: string): boolean {
  return true; // Open access
}
