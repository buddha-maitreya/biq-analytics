/**
 * Type augmentation for @agentuity/frontend.
 *
 * The @agentuity/runtime source (index.ts) re-exports BEACON_SCRIPT and
 * validateBeaconScript from @agentuity/frontend, but the installed version
 * of @agentuity/frontend doesn't export them yet (SDK version mismatch).
 *
 * Since `skipLibCheck` only skips .d.ts files and the runtime ships actual
 * .ts source, tsc type-checks it and fails. This augmentation adds the
 * missing exports so tsc passes cleanly.
 */

declare module "@agentuity/frontend" {
  export const BEACON_SCRIPT: string;
  export function validateBeaconScript(script: string): boolean;
}
