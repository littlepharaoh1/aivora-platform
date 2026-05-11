/**
 * adminAllowlist.ts — Admin email allowlist
 * Add your email here to get owner/admin role
 */

export const ADMIN_EMAILS: string[] = [
  // Add your email here:
  "zikaaaa460@gmail.com",  // Owner
];

export const OWNER_EMAILS: string[] = [
  // Add owner emails here:
  "zikaaaa460@gmail.com",  // Owner
];

export function getRoleFromEmail(email: string): string {
  if (OWNER_EMAILS.includes(email.toLowerCase())) return "owner";
  if (ADMIN_EMAILS.includes(email.toLowerCase()))  return "admin";
  return "client_viewer";
}
