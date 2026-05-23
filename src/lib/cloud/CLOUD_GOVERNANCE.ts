/**
 * CLOUD_GOVERNANCE.ts — Cloud Execution Feature Flags
 * Aivora Audio Infrastructure Platform — Prompt 6B
 *
 * Prompt 6B scope: browser-local inference ONLY.
 * Cloud modules are DISABLED until enterprise multi-tenant phase.
 *
 * To enable: require explicit architectural approval + Prompt 8+
 */

export const CLOUD_GOVERNANCE = {
  ENABLE_CLOUD_EXECUTION:    false,  // forbidden in Prompt 6B
  ENABLE_EXTERNAL_TELEMETRY: false,  // forbidden in Prompt 6B
  ENABLE_REMOTE_INFERENCE:   false,  // forbidden in Prompt 6B
  ENABLE_CLOUD_STORAGE:      false,  // forbidden in Prompt 6B
  ENABLE_CLOUD_SCHEDULING:   false,  // forbidden in Prompt 6B
} as const;

/**
 * Guard function — call at entry of any cloud operation.
 * Throws if cloud execution is disabled.
 */
export function assertCloudEnabled(operation: string): void {
  if(!CLOUD_GOVERNANCE.ENABLE_CLOUD_EXECUTION) {
    throw new Error(
      `[CloudGovernance] Operation "${operation}" blocked: ` +
      `ENABLE_CLOUD_EXECUTION=false (Prompt 6B scope: browser-local only)`
    );
  }
}

export function assertExternalTelemetryEnabled(operation: string): void {
  if(!CLOUD_GOVERNANCE.ENABLE_EXTERNAL_TELEMETRY) {
    throw new Error(
      `[CloudGovernance] Operation "${operation}" blocked: ` +
      `ENABLE_EXTERNAL_TELEMETRY=false (Prompt 6B scope: no external telemetry)`
    );
  }
}
