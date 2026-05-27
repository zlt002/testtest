export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code = 'http_error'
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
