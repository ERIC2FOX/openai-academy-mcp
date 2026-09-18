export class ConnectorError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 500,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ConnectorError";
  }
}

export function asConnectorError(error: unknown): ConnectorError {
  if (error instanceof ConnectorError) return error;
  if (error instanceof Error && error.name === "AbortError") {
    return new ConnectorError("NETWORK_TIMEOUT", "The Academy request timed out.", 504);
  }
  return new ConnectorError("INTERNAL_ERROR", "The connector could not complete the request.", 500);
}
