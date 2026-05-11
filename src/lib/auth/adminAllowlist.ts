/**
 * adminAllowlist.ts — Access Control
 * Aivora Platform Enterprise Auth
 */

export const OWNER_EMAILS: string[] = [
  "zikaaaa460@gmail.com",
];

export const ADMIN_EMAILS: string[] = [
  "zikaaaa460@gmail.com",
];

// All emails allowed to access the platform
// Empty = open access, add emails to restrict
export const ALLOWED_EMAILS: string[] = [
  "zikaaaa460@gmail.com",
  "aivoraailtduk@gmail.com",
  "aivoracontrol@gmail.com",
  "aivoraleader@gmail.com",
  "aivoraqa@gmail.com",
  // Add more emails here
];

export const RESTRICT_ACCESS = false; // Set true to enforce allowlist

export function getRoleFromEmail(email: string): string {
  const e = email.toLowerCase();
  if (OWNER_EMAILS.includes(e)) return "owner";
  if (ADMIN_EMAILS.includes(e))  return "admin";
  return "client_viewer";
}

export function isEmailAllowed(email: string): boolean {
  if (!RESTRICT_ACCESS) return true;
  return ALLOWED_EMAILS.includes(email.toLowerCase());
}
