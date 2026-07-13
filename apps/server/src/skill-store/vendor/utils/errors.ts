export class SkillHubError extends Error {
  public override name: string = "SkillHubError";
}

export class ConfigValidationError extends SkillHubError {
  public override name: string = "ConfigValidationError";
}

export class ManifestValidationError extends SkillHubError {
  public override name: string = "ManifestValidationError";
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
