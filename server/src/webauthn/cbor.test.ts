import { describe, expect, it } from 'vitest';
import { standardCbor } from '../../test/cbor-encoder.js';
import { cborItemLength } from './cbor.js';
import { ParseError } from './errors.js';

const cbor = standardCbor;

describe('cborItemLength', () => {
  it.each([
    ['small int', 1],
    ['negative int', -257],
    ['byte string', Buffer.alloc(300)],
    ['text', 'none'],
    [
      'nested map',
      new Map<unknown, unknown>([
        [1, 2],
        [-2, Buffer.alloc(32)],
        ['k', [1, [2, 3]]],
      ]),
    ],
  ])('measures a %s', (_name, value) => {
    const item = cbor.encode(value);
    const withTrailer = Buffer.concat([item, Buffer.from([0xa0])]);
    expect(cborItemLength(withTrailer, 0)).toBe(item.length);
  });

  it('rejects indefinite-length items', () => {
    expect(() => cborItemLength(Buffer.from([0x9f, 0x01, 0xff]), 0)).toThrow(ParseError);
  });

  it('rejects truncated data', () => {
    expect(() => cborItemLength(Buffer.from([0x58, 0x05, 0x01]), 0)).toThrow(ParseError);
  });
});
