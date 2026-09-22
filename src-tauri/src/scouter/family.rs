// 오브젝트 종류 → Family
//
// **종류 이름으로 WAS 인지 가르면 안 된다.** 운영에서는 에이전트의 `monitoring_group_type`
// 에 시스템 이름(`ORDER-JVM`)을 넣어 종류를 바꿔 쓴다. 이름 목록(`tomcat`·`java`…)으로
// 가르면 그런 서버는 WAS 로 안 잡혀 Active 탭·카운터에서 통째로 빠진다.
//
// **콜렉터가 이미 안다.** 처음 보는 종류의 에이전트가 붙으면 콜렉터가
// (`CounterManager.addObjectTypeIfNotExist`) ObjectPack 의 `tags.detected`(에이전트가 감지한
// `tomcat` 등)의 Family 를 물려받아 새 종류로 등록하고 사이트 정의(counters.site.xml)에 쓴다.
// `GET_XML_COUNTER` 가 기본 정의(`default`)와 사이트 정의(`custom`)를 Blob 으로 준다.
//
// 실측 — 테스트 에이전트에 `monitoring_group_type=SHOP-JVM` 을 걸자 재시작 없이 종류가
// `SHOP-JVM` 으로 바뀌고, 사이트 정의에 `SHOP-JVM → javaee` 가 생겼다
// (`probe_object_type_families`).

use serde::Serialize;

use super::pack::MapPack;
use super::value::ScouterValue;

/// 종류 하나의 Family
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ObjectTypeFamily {
    pub name: String,
    pub family: String,
}

/// counters.xml 한 벌에서 `<ObjectType name=".." family="..">` 를 뽑는다.
///
/// XML 해석기를 들이지 않는다 — 필요한 것은 한 태그의 속성 둘뿐이다. 대신
/// **속성 순서와 따옴표 종류에 기대지 않는다.** 사이트 정의는 콜렉터가 쓰지만
/// 사람이 손으로 고치기도 하는 파일이다.
pub fn parse_object_types(xml: &str) -> Vec<ObjectTypeFamily> {
    let mut out = Vec::new();
    let mut rest = xml;
    while let Some(at) = rest.find("<ObjectType") {
        let after = &rest[at + "<ObjectType".len()..];
        // `<ObjectTypes>` 같은 다른 태그를 잘못 집지 않는다 — 이름 바로 뒤는 공백이어야 한다.
        let is_tag = after.chars().next().is_some_and(|c| c.is_whitespace());
        let end = after.find('>').unwrap_or(after.len());
        if is_tag {
            let head = &after[..end];
            if let (Some(name), Some(family)) = (attr(head, "name"), attr(head, "family")) {
                if !name.is_empty() && !family.is_empty() {
                    out.push(ObjectTypeFamily { name, family });
                }
            }
        }
        rest = &after[end.min(after.len())..];
    }
    out
}

/// 태그 머리에서 속성 하나. `name="x"` · `name='x'` · 앞뒤 공백을 다 받는다
fn attr(head: &str, key: &str) -> Option<String> {
    let mut search = head;
    loop {
        let at = search.find(key)?;
        // `displayName` 안의 `name` 을 집으면 안 된다 — 앞이 공백이어야 속성 이름의 시작이다.
        let before_ok = at == 0
            || search[..at].chars().next_back().is_some_and(|c| c.is_whitespace());
        let after = search[at + key.len()..].trim_start();
        if before_ok {
            if let Some(v) = after.strip_prefix('=') {
                let v = v.trim_start();
                let quote = v.chars().next()?;
                if quote == '"' || quote == '\'' {
                    let body = &v[1..];
                    let close = body.find(quote)?;
                    return Some(body[..close].trim().to_string());
                }
            }
        }
        search = &search[at + key.len()..];
    }
}

/// `GET_XML_COUNTER` 응답에서 종류→Family 표를 만든다.
///
/// **사이트 정의가 기본을 이긴다** — 콜렉터도 기본 위에 사이트 정의를 덮어 읽는다.
/// Blob 이 아니거나 비어 있으면 그 벌만 건너뛴다.
pub fn parse_counter_xml_families(map: &MapPack) -> Vec<ObjectTypeFamily> {
    let mut merged: Vec<ObjectTypeFamily> = Vec::new();
    for key in ["default", "custom"] {
        let Some(ScouterValue::Blob(bytes)) = map.entries.get(key) else {
            continue;
        };
        for t in parse_object_types(&String::from_utf8_lossy(bytes)) {
            match merged.iter_mut().find(|m| m.name == t.name) {
                Some(slot) => slot.family = t.family,
                None => merged.push(t),
            }
        }
    }
    merged
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(v: &[ObjectTypeFamily]) -> Vec<(&str, &str)> {
        v.iter().map(|t| (t.name.as_str(), t.family.as_str())).collect()
    }

    #[test]
    fn 기본_정의의_종류를_뽑는다() {
        let xml = r#"<Types>
            <ObjectType name="tomcat" family="javaee" icon="tomcat" displayName="Tomcat"/>
            <ObjectType name="linux" family="host" displayName="Linux"/>
        </Types>"#;
        assert_eq!(parse_object_types(xml), vec![
            ObjectTypeFamily { name: "tomcat".into(), family: "javaee".into() },
            ObjectTypeFamily { name: "linux".into(), family: "host".into() },
        ]);
    }

    #[test]
    fn 속성_순서와_따옴표에_기대지_않는다() {
        // 사이트 정의는 사람이 손으로 고치기도 한다.
        let xml = r#"<ObjectType family='javaee' name = "ORDER-JVM" />"#;
        assert_eq!(names(&parse_object_types(xml)), vec![("ORDER-JVM", "javaee")]);
    }

    #[test]
    fn display_name_안의_name_을_집지_않는다() {
        let xml = r#"<ObjectType displayName="X" family="host" name="ORDER-LINUX"/>"#;
        assert_eq!(names(&parse_object_types(xml)), vec![("ORDER-LINUX", "host")]);
    }

    #[test]
    fn object_types_같은_다른_태그를_집지_않는다() {
        let xml = r#"<ObjectTypes><ObjectType name="a" family="javaee"/></ObjectTypes>"#;
        assert_eq!(names(&parse_object_types(xml)), vec![("a", "javaee")]);
    }

    #[test]
    fn family_가_없는_종류는_버린다() {
        // 모르는 것을 지어내지 않는다. 화면은 이름 목록으로 다시 가른다.
        let xml = r#"<ObjectType name="odd"/>"#;
        assert!(parse_object_types(xml).is_empty());
    }

    #[test]
    fn 사이트_정의가_기본을_이긴다() {
        let mut m = MapPack::new();
        m.put(
            "default",
            ScouterValue::Blob(br#"<ObjectType name="tomcat" family="javaee"/><ObjectType name="x" family="host"/>"#.to_vec()),
        );
        m.put(
            "custom",
            ScouterValue::Blob(br#"<ObjectType name="x" family="javaee"/><ObjectType name="SHOP-JVM" family="javaee"/>"#.to_vec()),
        );
        assert_eq!(
            names(&parse_counter_xml_families(&m)),
            vec![("tomcat", "javaee"), ("x", "javaee"), ("SHOP-JVM", "javaee")]
        );
    }

    #[test]
    fn 사이트_정의가_없어도_기본은_준다() {
        // 커스텀 종류를 한 번도 안 쓴 콜렉터는 custom 이 없다 (실측).
        let mut m = MapPack::new();
        m.put("default", ScouterValue::Blob(br#"<ObjectType name="tomcat" family="javaee"/>"#.to_vec()));
        assert_eq!(names(&parse_counter_xml_families(&m)), vec![("tomcat", "javaee")]);
    }
}
