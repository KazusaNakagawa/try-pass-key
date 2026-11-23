import { Encoder, type Options } from 'cbor-x';

/**
 * Standard CBOR, as an authenticator would emit it.
 * cbor-x tags Maps with non-string keys as tag 259 by default; real authenticators
 * never do. `useTag259ForMaps` is supported at runtime but missing from cbor-x's
 * type definitions, hence the widened type.
 */
export const standardCbor = new Encoder({
  useRecords: false,
  mapsAsObjects: false,
  useTag259ForMaps: false,
  tagUint8Array: false,
} as Options & { useTag259ForMaps: boolean });
