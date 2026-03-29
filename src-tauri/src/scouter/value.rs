// src-tauri/src/scouter/value.rs
// ScouterValue enum - ValueEnum 포팅
// 참조: docs/asis/14-collector-tcp-protocol.md 섹션 2.7

use std::collections::HashMap;
use std::io;

use super::codec::{ScouterReader, ScouterWriter};
use super::protocol::*;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "type", content = "value")]
pub enum ScouterValue {
    Null,
    Boolean(bool),
    Decimal(i64),
    Float(f32),
    Double(f64),
    Text(String),
    Blob(Vec<u8>),
    List(Vec<ScouterValue>),
    Map(HashMap<String, ScouterValue>),
}

impl ScouterValue {
    /// 타입 코드 반환
    pub fn type_code(&self) -> u8 {
        match self {
            Self::Null => VALUE_NULL,
            Self::Boolean(_) => VALUE_BOOLEAN,
            Self::Decimal(_) => VALUE_DECIMAL,
            Self::Float(_) => VALUE_FLOAT,
            Self::Double(_) => VALUE_DOUBLE,
            Self::Text(_) => VALUE_TEXT,
            Self::Blob(_) => VALUE_BLOB,
            Self::List(_) => VALUE_LIST,
            Self::Map(_) => VALUE_MAP,
        }
    }

    /// ScouterReader에서 타입 코드를 읽고 값 역직렬화
    pub fn read_from(r: &mut ScouterReader) -> io::Result<Self> {
        let type_code = r.read_unsigned_byte()?;
        Self::read_body(r, type_code)
    }

    /// 타입 코드를 알고 있을 때 본문만 읽기
    pub fn read_body(r: &mut ScouterReader, type_code: u8) -> io::Result<Self> {
        match type_code {
            VALUE_NULL => Ok(Self::Null),
            VALUE_BOOLEAN => Ok(Self::Boolean(r.read_boolean()?)),
            VALUE_DECIMAL => Ok(Self::Decimal(r.read_decimal()?)),
            VALUE_FLOAT => Ok(Self::Float(r.read_float()?)),
            VALUE_DOUBLE => Ok(Self::Double(r.read_double()?)),
            VALUE_TEXT => Ok(Self::Text(r.read_text()?)),
            VALUE_BLOB => Ok(Self::Blob(r.read_blob()?)),
            VALUE_LIST => {
                let count = r.read_decimal()? as usize;
                let mut items = Vec::with_capacity(count);
                for _ in 0..count {
                    items.push(Self::read_from(r)?);
                }
                Ok(Self::List(items))
            }
            VALUE_MAP => {
                let count = r.read_decimal()? as usize;
                let mut map = HashMap::with_capacity(count);
                for _ in 0..count {
                    let key = r.read_text()?;
                    let val = Self::read_from(r)?;
                    map.insert(key, val);
                }
                Ok(Self::Map(map))
            }
            _ => Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("알 수 없는 ValueEnum 타입 코드: 0x{type_code:02X}"),
            )),
        }
    }

    /// ScouterWriter에 타입 코드 + 값 직렬화
    pub fn write_to(&self, w: &mut ScouterWriter) {
        w.write_unsigned_byte(self.type_code());
        self.write_body(w);
    }

    fn write_body(&self, w: &mut ScouterWriter) {
        match self {
            Self::Null => {}
            Self::Boolean(v) => w.write_boolean(*v),
            Self::Decimal(v) => w.write_decimal(*v),
            Self::Float(v) => w.write_float(*v),
            Self::Double(v) => w.write_double(*v),
            Self::Text(v) => w.write_text(v),
            Self::Blob(v) => w.write_blob(v),
            Self::List(items) => {
                w.write_decimal(items.len() as i64);
                for item in items {
                    item.write_to(w);
                }
            }
            Self::Map(map) => {
                w.write_decimal(map.len() as i64);
                for (k, v) in map {
                    w.write_text(k);
                    v.write_to(w);
                }
            }
        }
    }

    // ─── 편의 메서드 ──────────────────────────────────────────

    pub fn as_decimal(&self) -> Option<i64> {
        match self {
            Self::Decimal(v) => Some(*v),
            _ => None,
        }
    }

    pub fn as_text(&self) -> Option<&str> {
        match self {
            Self::Text(v) => Some(v.as_str()),
            _ => None,
        }
    }

    pub fn as_list(&self) -> Option<&[ScouterValue]> {
        match self {
            Self::List(v) => Some(v.as_slice()),
            _ => None,
        }
    }

    pub fn into_decimal_list(self) -> Option<Vec<i64>> {
        match self {
            Self::List(items) => {
                items.into_iter().map(|v| v.as_decimal()).collect()
            }
            _ => None,
        }
    }
}
