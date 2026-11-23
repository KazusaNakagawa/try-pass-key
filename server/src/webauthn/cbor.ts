import { Decoder } from 'cbor-x';
import { ParseError } from './errors.js';

// Maps keep their integer keys (COSE uses -1, -2, 3, ...), so decode them as Map.
const decoder = new Decoder({ mapsAsObjects: false, useRecords: false });

export function decodeCbor(bytes: Uint8Array): unknown {
  try {
    return decoder.decode(bytes) as unknown;
  } catch (err) {
    throw new ParseError(`invalid CBOR: ${String(err)}`);
  }
}

/**
 * Byte length of the CBOR item that starts at `start`.
 *
 * authenticatorData places the credential public key (CBOR) directly before the
 * optional extensions (CBOR) with no length prefix, so the key's raw bytes can
 * only be cut out by measuring the item. cbor-x does the decoding; this only
 * walks the item headers. Indefinite lengths are rejected: CTAP2 requires
 * canonical CBOR.
 */
export function cborItemLength(bytes: Uint8Array, start: number): number {
  return skipItem(bytes, start) - start;
}

function skipItem(bytes: Uint8Array, pos: number): number {
  const initial = bytes.at(pos);
  if (initial === undefined) throw new ParseError('CBOR: unexpected end of data');
  const major = initial >> 5;
  const info = initial & 0x1f;
  const { value, next } = readArgument(bytes, pos + 1, info);

  switch (major) {
    case 0: // unsigned int
    case 1: // negative int
    case 7: // simple / float (argument already consumed)
      return next;
    case 2: // byte string
    case 3: {
      // text string
      const end = next + value;
      if (end > bytes.length) throw new ParseError('CBOR: string runs past the end');
      return end;
    }
    case 4: {
      // array
      let p = next;
      for (let i = 0; i < value; i++) p = skipItem(bytes, p);
      return p;
    }
    case 5: {
      // map
      let p = next;
      for (let i = 0; i < value * 2; i++) p = skipItem(bytes, p);
      return p;
    }
    default: // 6: tag, followed by one item
      return skipItem(bytes, next);
  }
}

function readArgument(bytes: Uint8Array, pos: number, info: number) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const need = (n: number) => {
    if (pos + n > bytes.length) throw new ParseError('CBOR: unexpected end of data');
  };
  if (info < 24) return { value: info, next: pos };
  switch (info) {
    case 24:
      need(1);
      return { value: view.getUint8(pos), next: pos + 1 };
    case 25:
      need(2);
      return { value: view.getUint16(pos), next: pos + 2 };
    case 26:
      need(4);
      return { value: view.getUint32(pos), next: pos + 4 };
    case 27: {
      need(8);
      const big = view.getBigUint64(pos);
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new ParseError('CBOR: length too large');
      return { value: Number(big), next: pos + 8 };
    }
    case 31:
      throw new ParseError('CBOR: indefinite length is not allowed');
    default:
      throw new ParseError('CBOR: reserved additional information');
  }
}
