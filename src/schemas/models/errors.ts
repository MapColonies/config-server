export class SchemaNotFoundError extends Error {

  public constructor(message?: string) {
    super(message ?? 'Schema not found');
    Object.setPrototypeOf(this, SchemaNotFoundError.prototype);
  }
}

export class SchemaPathIsInvalidError extends Error {
  public constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, SchemaPathIsInvalidError.prototype);
  }
}
