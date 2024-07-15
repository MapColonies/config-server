export class ConfigNotFoundError extends Error {
  public constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, ConfigNotFoundError.prototype);
  }
}

export class ConfigVersionMismatchError extends Error {
  public constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, ConfigVersionMismatchError.prototype);
  }
}

export class ConfigSchemaMismatchError extends Error {
  public constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, ConfigSchemaMismatchError.prototype);
  }
}

export class ConfigValidationError extends Error {
  public constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, ConfigValidationError.prototype);
  }
}
