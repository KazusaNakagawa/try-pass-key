/** The response could not be decoded (bad base64url, CBOR, JSON or binary layout). */
export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}
