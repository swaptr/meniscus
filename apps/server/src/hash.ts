/** SHA-256 fingerprints, shared by the tray read (`image_sha256`) and the media store (`media.sha256`), so both hash alike. */
import { createHash } from 'node:crypto'

/** Lowercase hex SHA-256 of these bytes. */
export const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
