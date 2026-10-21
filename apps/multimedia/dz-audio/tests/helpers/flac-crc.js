// FLAC frame CRCs (RFC 9639): CRC-8 poly 0x07 over the header, CRC-16 poly 0x8005 over the frame.
export function crc8Flac(bytes) {
  let crc = 0;
  for (const b of bytes) {
    crc ^= b;
    for (let k = 0; k < 8; k++) crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 255 : (crc << 1) & 255;
  }
  return crc;
}

export function crc16Flac(bytes) {
  let crc = 0;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let k = 0; k < 8; k++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x8005) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}
