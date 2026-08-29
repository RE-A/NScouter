// src-tauri/src/scouter/codec.rs
// DataInputX / DataOutputX 포팅
// 참조: docs/asis/14-collector-tcp-protocol.md 섹션 2

use std::io::{self, Cursor, Read, Write};

// ─── Decimal 범위 상수 ────────────────────────────────────────
const INT3_MIN: i64 = -8_388_608;
const INT3_MAX: i64 = 8_388_607;
const LONG5_MIN: i64 = 0xffffff8000000000u64 as i64;
const LONG5_MAX: i64 = 0x0000007fffffffff;

// ─── ScouterReader ────────────────────────────────────────────

/// DataInputX 포팅. Big-endian 바이너리 읽기 전용.
pub struct ScouterReader {
    inner: Cursor<Vec<u8>>,
}

impl ScouterReader {
    pub fn new(data: Vec<u8>) -> Self {
        Self { inner: Cursor::new(data) }
    }

    pub fn position(&self) -> u64 {
        self.inner.position()
    }

    pub fn remaining(&self) -> usize {
        let pos = self.inner.position() as usize;
        let len = self.inner.get_ref().len();
        len.saturating_sub(pos)
    }

    pub fn read_byte(&mut self) -> io::Result<i8> {
        let mut buf = [0u8; 1];
        self.inner.read_exact(&mut buf)?;
        Ok(buf[0] as i8)
    }

    pub fn read_unsigned_byte(&mut self) -> io::Result<u8> {
        let mut buf = [0u8; 1];
        self.inner.read_exact(&mut buf)?;
        Ok(buf[0])
    }

    pub fn read_short(&mut self) -> io::Result<i16> {
        let mut buf = [0u8; 2];
        self.inner.read_exact(&mut buf)?;
        Ok(i16::from_be_bytes(buf))
    }

    pub fn read_unsigned_short(&mut self) -> io::Result<u16> {
        let mut buf = [0u8; 2];
        self.inner.read_exact(&mut buf)?;
        Ok(u16::from_be_bytes(buf))
    }

    pub fn read_int(&mut self) -> io::Result<i32> {
        let mut buf = [0u8; 4];
        self.inner.read_exact(&mut buf)?;
        Ok(i32::from_be_bytes(buf))
    }

    pub fn read_long(&mut self) -> io::Result<i64> {
        let mut buf = [0u8; 8];
        self.inner.read_exact(&mut buf)?;
        Ok(i64::from_be_bytes(buf))
    }

    pub fn read_float(&mut self) -> io::Result<f32> {
        let bits = self.read_int()?;
        Ok(f32::from_bits(bits as u32))
    }

    pub fn read_double(&mut self) -> io::Result<f64> {
        let bits = self.read_long()?;
        Ok(f64::from_bits(bits as u64))
    }

    pub fn read_boolean(&mut self) -> io::Result<bool> {
        Ok(self.read_unsigned_byte()? != 0)
    }

    /// 3바이트 Big-endian 부호 있는 정수 (Int3)
    pub fn read_int3(&mut self) -> io::Result<i32> {
        let mut buf = [0u8; 3];
        self.inner.read_exact(&mut buf)?;
        let ch1 = buf[0] as i32;
        let ch2 = buf[1] as i32;
        let ch3 = buf[2] as i32;
        // 부호 확장: (ch1 << 24) + (ch2 << 16) + (ch3 << 8) >> 8
        Ok(((ch1 << 24) + (ch2 << 16) + (ch3 << 8)) >> 8)
    }

    /// 5바이트 Big-endian 부호 있는 정수 (Long5)
    pub fn read_long5(&mut self) -> io::Result<i64> {
        let mut buf = [0u8; 5];
        self.inner.read_exact(&mut buf)?;
        // buf[0]은 Java의 (long) buf[pos] 처럼 signed byte로 sign-extend해야 함
        let v = ((buf[0] as i8 as i64) << 32)
            + ((buf[1] as i64 & 0xff) << 24)
            + ((buf[2] as i64 & 0xff) << 16)
            + ((buf[3] as i64 & 0xff) << 8)
            + (buf[4] as i64 & 0xff);
        Ok(v)
    }

    /// 가변 길이 정수 (Decimal). 1~9바이트.
    pub fn read_decimal(&mut self) -> io::Result<i64> {
        let len = self.read_byte()?;
        match len {
            0 => Ok(0),
            1 => Ok(self.read_byte()? as i64),
            2 => Ok(self.read_short()? as i64),
            3 => Ok(self.read_int3()? as i64),
            4 => Ok(self.read_int()? as i64),
            5 => Ok(self.read_long5()?),
            _ => Ok(self.read_long()?), // len == 8
        }
    }

    /// 가변 길이 바이트 배열 (Blob)
    pub fn read_blob(&mut self) -> io::Result<Vec<u8>> {
        let base = self.read_unsigned_byte()?;
        let len = match base {
            0 => return Ok(Vec::new()),
            255 => self.read_unsigned_short()? as usize, // 0xFF: ushort 길이
            254 => self.read_int()? as usize,            // 0xFE: int 길이
            n => n as usize,                             // 1~253: 직접 길이
        };
        let mut buf = vec![0u8; len];
        self.inner.read_exact(&mut buf)?;
        Ok(buf)
    }

    /// UTF-8 문자열 (Blob 포맷)
    pub fn read_text(&mut self) -> io::Result<String> {
        let blob = self.read_blob()?;
        String::from_utf8(blob).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
    }

    /// 남은 바이트 전체 읽기
    pub fn read_remaining(&mut self) -> io::Result<Vec<u8>> {
        let mut buf = Vec::new();
        self.inner.read_to_end(&mut buf)?;
        Ok(buf)
    }
}

// ─── ScouterWriter ────────────────────────────────────────────

/// DataOutputX 포팅. Big-endian 바이너리 쓰기 전용.
pub struct ScouterWriter {
    buf: Vec<u8>,
}

impl Default for ScouterWriter {
    fn default() -> Self {
        Self::new()
    }
}

impl ScouterWriter {
    pub fn new() -> Self {
        Self { buf: Vec::new() }
    }

    pub fn into_bytes(self) -> Vec<u8> {
        self.buf
    }

    pub fn as_bytes(&self) -> &[u8] {
        &self.buf
    }

    pub fn write_byte(&mut self, v: i8) {
        self.buf.push(v as u8);
    }

    pub fn write_unsigned_byte(&mut self, v: u8) {
        self.buf.push(v);
    }

    pub fn write_short(&mut self, v: i16) {
        self.buf.extend_from_slice(&v.to_be_bytes());
    }

    pub fn write_int(&mut self, v: i32) {
        self.buf.extend_from_slice(&v.to_be_bytes());
    }

    pub fn write_long(&mut self, v: i64) {
        self.buf.extend_from_slice(&v.to_be_bytes());
    }

    pub fn write_float(&mut self, v: f32) {
        self.write_int(v.to_bits() as i32);
    }

    pub fn write_double(&mut self, v: f64) {
        self.write_long(v.to_bits() as i64);
    }

    pub fn write_boolean(&mut self, v: bool) {
        self.buf.push(if v { 1 } else { 0 });
    }

    /// 3바이트 Big-endian 정수 (Int3)
    pub fn write_int3(&mut self, v: i32) {
        self.buf.push(((v >> 16) & 0xFF) as u8);
        self.buf.push(((v >> 8) & 0xFF) as u8);
        self.buf.push((v & 0xFF) as u8);
    }

    /// 5바이트 Big-endian 정수 (Long5)
    pub fn write_long5(&mut self, v: i64) {
        self.buf.push((v >> 32) as u8);
        self.buf.push((v >> 24) as u8);
        self.buf.push((v >> 16) as u8);
        self.buf.push((v >> 8) as u8);
        self.buf.push(v as u8);
    }

    /// 가변 길이 정수 (Decimal). 1~9바이트.
    pub fn write_decimal(&mut self, v: i64) {
        if v == 0 {
            self.buf.push(0x00);
        } else if (-128..=127).contains(&v) {
            self.buf.push(0x01);
            self.write_byte(v as i8);
        } else if (-32768..=32767).contains(&v) {
            self.buf.push(0x02);
            self.write_short(v as i16);
        } else if (INT3_MIN..=INT3_MAX).contains(&v) {
            self.buf.push(0x03);
            self.write_int3(v as i32);
        } else if (i32::MIN as i64..=i32::MAX as i64).contains(&v) {
            self.buf.push(0x04);
            self.write_int(v as i32);
        } else if (LONG5_MIN..=LONG5_MAX).contains(&v) {
            self.buf.push(0x05);
            self.write_long5(v);
        } else {
            self.buf.push(0x08);
            self.write_long(v);
        }
    }

    /// 가변 길이 바이트 배열 (Blob)
    pub fn write_blob(&mut self, data: &[u8]) {
        let len = data.len();
        if len == 0 {
            self.buf.push(0x00);
        } else if len <= 253 {
            self.buf.push(len as u8);
            self.buf.extend_from_slice(data);
        } else if len <= 65535 {
            self.buf.push(0xFF);
            self.write_short(len as i16); // write as unsigned short (BE)
            self.buf.extend_from_slice(data);
        } else {
            self.buf.push(0xFE);
            self.write_int(len as i32);
            self.buf.extend_from_slice(data);
        }
    }

    /// UTF-8 문자열 (Blob 포맷)
    pub fn write_text(&mut self, s: &str) {
        if s.is_empty() {
            self.buf.push(0x00);
        } else {
            self.write_blob(s.as_bytes());
        }
    }

    /// 4바이트 Big-endian u32 (매직 넘버 전송용)
    pub fn write_u32(&mut self, v: u32) {
        self.buf.extend_from_slice(&v.to_be_bytes());
    }
}

impl Write for ScouterWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.buf.extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

// ─── 단위 테스트 ──────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;

    fn roundtrip_decimal(v: i64) {
        let mut w = ScouterWriter::new();
        w.write_decimal(v);
        let mut r = ScouterReader::new(w.into_bytes());
        assert_eq!(r.read_decimal().unwrap(), v, "decimal roundtrip failed for {v}");
    }

    #[test]
    fn test_decimal_zero() {
        roundtrip_decimal(0);
    }

    #[test]
    fn test_decimal_byte_boundaries() {
        roundtrip_decimal(-128);
        roundtrip_decimal(127);
    }

    #[test]
    fn test_decimal_short_boundaries() {
        roundtrip_decimal(-129);
        roundtrip_decimal(128);
        roundtrip_decimal(-32768);
        roundtrip_decimal(32767);
    }

    #[test]
    fn test_decimal_int3_boundaries() {
        roundtrip_decimal(-8_388_608);
        roundtrip_decimal(8_388_607);
    }

    #[test]
    fn test_decimal_int_boundaries() {
        roundtrip_decimal(i32::MIN as i64);
        roundtrip_decimal(i32::MAX as i64);
    }

    #[test]
    fn test_decimal_long5_boundaries() {
        roundtrip_decimal(LONG5_MIN);
        roundtrip_decimal(LONG5_MAX);
    }

    #[test]
    fn test_decimal_long_boundaries() {
        roundtrip_decimal(i64::MIN);
        roundtrip_decimal(i64::MAX);
    }

    fn roundtrip_blob(data: &[u8]) {
        let mut w = ScouterWriter::new();
        w.write_blob(data);
        let mut r = ScouterReader::new(w.into_bytes());
        assert_eq!(r.read_blob().unwrap(), data, "blob roundtrip failed for len={}", data.len());
    }

    #[test]
    fn test_blob_empty() {
        roundtrip_blob(&[]);
    }

    #[test]
    fn test_blob_small() {
        roundtrip_blob(&[1, 2, 3]);
        roundtrip_blob(&vec![0xAA; 253]);
    }

    #[test]
    fn test_blob_medium() {
        // 254~65535 범위 → 0xFF + ushort
        roundtrip_blob(&vec![0xBB; 254]);
        roundtrip_blob(&vec![0xCC; 1000]);
    }

    #[test]
    fn test_blob_large() {
        // 65536+ → 0xFE + int
        roundtrip_blob(&vec![0xDD; 65536]);
    }

    #[test]
    fn test_text_roundtrip() {
        let mut w = ScouterWriter::new();
        w.write_text("hello, 스카우터");
        let mut r = ScouterReader::new(w.into_bytes());
        assert_eq!(r.read_text().unwrap(), "hello, 스카우터");
    }

    #[test]
    fn test_basic_types() {
        let mut w = ScouterWriter::new();
        w.write_int(0x0102_0304);
        w.write_long(0x0102_0304_0506_0708);
        w.write_boolean(true);
        w.write_boolean(false);

        let mut r = ScouterReader::new(w.into_bytes());
        assert_eq!(r.read_int().unwrap(), 0x0102_0304);
        assert_eq!(r.read_long().unwrap(), 0x0102_0304_0506_0708);
        assert!(r.read_boolean().unwrap());
        assert!(!r.read_boolean().unwrap());
    }
}
