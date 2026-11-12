// 통계 비교 — 서비스 묶음 하나의 현재 구간과 기준(평소) 구간들을 서비스별로 견준다
//
// 화면의 «통계» 탭이 쓴다. 작업은 길다(하루치를 훑는다) — **백그라운드에서 돌고** 진행 상황을 이벤트로
// 알리며(`stats-progress`), 일시정지·취소할 수 있고, 끝난 결과는 파일로 남아 나중에 다시 연다.
//
//   · `engine` — 구간을 훑어 서비스별로 센다 (멀티스레드, 여러 콜렉터)
//   · `model`  — 요청 · 서비스별 집계 · 결과의 모양
//   · `hist`   — 응답시간 히스토그램(1% 폭 로그 구간)
//
// **결과는 둘로 나눠 넘긴다.** 서비스가 수백 개면 5분 추이·분포까지 실은 결과가 수 MB 가 된다(CLAUDE.md 3.3).
// 비교 표에는 추이·분포를 뺀 것(`stats_result`)을, 서비스 하나를 펼칠 때 그 서비스의 전부(`stats_service`)를 준다.

pub mod engine;
pub mod hist;
pub mod model;
pub mod raw;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use engine::{Control, Estimate, Progress};
use model::{ServiceStats, StatsRequest, StatsResult};

use crate::scouter::connection::local_now_ms;
use crate::state::AppState;

/// 결과 폴더 이름 (`{data_dir}/stats/`)
pub const DIR_NAME: &str = "stats";
/// 메모리에 들고 있는 끝난 결과 수 — 넘으면 파일에서 다시 읽는다
const KEEP_IN_MEMORY: usize = 4;

/// 작업 하나
struct Job {
    request: StatsRequest,
    control: Control,
    progress: Mutex<Progress>,
    /// `running` · `done` · `cancelled` · `failed`
    status: Mutex<String>,
    result: Mutex<Option<Arc<StatsResult>>>,
}

#[derive(Default)]
pub struct StatsState {
    jobs: Mutex<HashMap<String, Arc<Job>>>,
    seq: AtomicU64,
}

/// 작업 목록 한 줄 (화면용) — 돌고 있는 것과 파일로 남은 것
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobInfo {
    pub id: String,
    pub title: String,
    pub status: String,
    pub started_at: i64,
    pub finished_at: i64,
    pub request: StatsRequest,
    /// 돌고 있을 때만
    pub progress: Option<Progress>,
    pub services: usize,
}

/// 비교 표에 쓸 결과 — 서비스마다 5분 추이·분포를 뺀다
fn compact(r: &StatsResult) -> StatsResult {
    let strip = |s: &Option<model::Summary>| {
        s.as_ref().map(|s| model::Summary { series: Vec::new(), dist: Vec::new(), ..s.clone() })
    };
    StatsResult {
        services: r
            .services
            .iter()
            .map(|s| ServiceStats { service: s.service.clone(), current: strip(&s.current), baseline: strip(&s.baseline) })
            .collect(),
        ..r.clone()
    }
}

fn info_of(id: &str, r: &StatsResult) -> JobInfo {
    JobInfo {
        id: id.to_string(),
        title: r.request.title.clone(),
        status: r.status.clone(),
        started_at: r.started_at,
        finished_at: r.finished_at,
        request: r.request.clone(),
        progress: None,
        services: r.services.len(),
    }
}

// ─── 파일 ────────────────────────────────────────────────────

fn result_path(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!("{id}.json"))
}

fn meta_path(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!("{id}.meta.json"))
}

/// 결과와 목록용 머리(작은 파일)를 남긴다. **임시 파일에 쓰고 바꿔 끼운다**
fn save(dir: &Path, r: &StatsResult) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("통계 폴더를 만들 수 없음: {e}"))?;
    let write = |p: PathBuf, body: String| -> Result<(), String> {
        let tmp = p.with_extension("tmp");
        std::fs::write(&tmp, body).map_err(|e| format!("통계 결과를 쓸 수 없음: {e}"))?;
        std::fs::rename(&tmp, &p).map_err(|e| format!("통계 결과를 쓸 수 없음: {e}"))
    };
    write(result_path(dir, &r.id), serde_json::to_string(r).map_err(|e| e.to_string())?)?;
    write(meta_path(dir, &r.id), serde_json::to_string(&info_of(&r.id, r)).map_err(|e| e.to_string())?)
}

fn load(dir: &Path, id: &str) -> Result<StatsResult, String> {
    // 이름에 경로가 섞이면 폴더 밖을 읽는다 — 숫자·영문·`-` 만 받는다
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(format!("잘못된 통계 결과 이름: {id}"));
    }
    let body = std::fs::read_to_string(result_path(dir, id)).map_err(|e| format!("통계 결과를 읽을 수 없음 ({id}): {e}"))?;
    serde_json::from_str(&body).map_err(|e| format!("통계 결과가 깨졌다 ({id}): {e}"))
}

fn list_saved(dir: &Path) -> Vec<JobInfo> {
    let Ok(rd) = std::fs::read_dir(dir) else { return Vec::new() };
    rd.flatten()
        .filter(|e| e.file_name().to_string_lossy().ends_with(".meta.json"))
        .filter_map(|e| std::fs::read_to_string(e.path()).ok())
        .filter_map(|b| serde_json::from_str::<JobInfo>(&b).ok())
        .collect()
}

async fn stats_dir(app: &AppHandle) -> PathBuf {
    app.state::<AppState>().stats_dir().await
}

// ─── 명령 ────────────────────────────────────────────────────

/// 예상 규모 — 구간별 대상 서버와 서비스 요약 건수 합. 시작 전에 «얼마나 걸릴 작업인가» 를 본다
#[tauri::command]
pub async fn stats_estimate(app: AppHandle, request: StatsRequest) -> Result<Estimate, String> {
    let app2 = app.clone();
    tokio::task::spawn_blocking(move || engine::estimate(&app2.state::<AppState>(), &request))
        .await
        .map_err(|e| format!("예상 작업 실패: {e}"))?
}

/// 통계 작업을 시작한다 — 작업 이름(id)을 돌려준다. 진행은 `stats-progress`, 끝은 `stats-done` 이벤트로 온다
#[tauri::command]
pub async fn stats_start(app: AppHandle, request: StatsRequest) -> Result<String, String> {
    request.validate()?;
    let st = app.state::<StatsState>();
    let id = format!("{}-{}", local_now_ms(), st.seq.fetch_add(1, Ordering::Relaxed));
    let job = Arc::new(Job {
        request: request.clone(),
        control: Control::default(),
        progress: Mutex::new(Progress { phase: "plan".into(), started_at: local_now_ms(), ..Progress::default() }),
        status: Mutex::new("running".into()),
        result: Mutex::new(None),
    });
    st.jobs.lock().unwrap_or_else(|p| p.into_inner()).insert(id.clone(), job.clone());
    let dir = stats_dir(&app).await;
    let export_dir = app.state::<AppState>().export_dir().await;

    let (app2, id2) = (app.clone(), id.clone());
    tauri::async_runtime::spawn(async move {
        let (app3, id3, job3) = (app2.clone(), id2.clone(), job.clone());
        let started_at = local_now_ms();
        // 원본 CSV — 파일을 못 만들면 통계는 그대로 돌리고 까닭만 남긴다
        let (sink, sink_error) = if job.request.raw {
            match raw::RawSink::create(&export_dir.join(raw_file_name(&job.request, started_at))) {
                Ok(s) => (Some(Arc::new(s)), None),
                Err(e) => (None, Some(e)),
            }
        } else {
            (None, None)
        };
        let sink3 = sink.clone();
        let outcome = tokio::task::spawn_blocking(move || {
            let state = app3.state::<AppState>();
            engine::run(&state, &job3.request, &job3.control, sink3.as_deref(), &|p: Progress| {
                *job3.progress.lock().unwrap_or_else(|e| e.into_inner()) = p.clone();
                let _ = app3.emit("stats-progress", serde_json::json!({ "id": id3, "progress": p }));
            })
        })
        .await
        .unwrap_or_else(|e| Err(format!("통계 작업이 중간에 끝났습니다: {e}")));

        let cancelled = job.control.cancel.load(Ordering::Relaxed);
        let req = &job.request;
        let secs = |rs: &[model::StatsRange]| rs.iter().map(|r| r.secs()).sum::<f64>();
        let result = match outcome {
            Ok((ranges, book, collectors)) => StatsResult {
                id: id2.clone(),
                request: req.clone(),
                started_at,
                finished_at: local_now_ms(),
                status: if cancelled { "cancelled" } else { "done" }.into(),
                message: None,
                collectors,
                ranges,
                services: book.finish(req.current.secs(), secs(&req.baselines)),
                ..StatsResult::default()
            },
            Err(e) => StatsResult {
                id: id2.clone(),
                request: req.clone(),
                started_at,
                finished_at: local_now_ms(),
                status: "failed".into(),
                message: Some(e),
                ..StatsResult::default()
            },
        };
        let mut result = result;
        if let Some(sink) = &sink {
            let (path, rows, err) = sink.finish();
            result.raw_path = Some(path);
            result.raw_rows = rows;
            result.raw_error = err;
        } else {
            result.raw_error = sink_error;
        }
        if let Err(e) = save(&dir, &result) {
            log::error!("통계 결과 저장 실패: {e}");
        }
        log::info!("통계 작업 {id2}: {} · 서비스 {}개", result.status, result.services.len());
        *job.status.lock().unwrap_or_else(|p| p.into_inner()) = result.status.clone();
        *job.result.lock().unwrap_or_else(|p| p.into_inner()) = Some(Arc::new(result.clone()));
        let _ = app2.emit("stats-done", serde_json::json!({ "id": id2, "status": result.status, "message": result.message }));
        trim_memory(&app2.state::<StatsState>());
    });
    Ok(id)
}

/// 원본 CSV 파일 이름 — `20261112-095012_stats-raw-shop-app.csv` (요약 CSV 와 같은 폴더·규칙)
fn raw_file_name(req: &StatsRequest, started_at: i64) -> String {
    let stamp = raw::file_stamp(started_at, req.tz_offset_ms);
    let target = req.groups.first().or(req.servers.first()).map(String::as_str).unwrap_or("target");
    format!("{stamp}_{}.csv", crate::profile_store::sanitize(&format!("stats-raw-{target}")))
}

/// 끝난 결과는 몇 개만 메모리에 둔다 — 나머지는 파일에서 다시 읽는다
fn trim_memory(st: &StatsState) {
    let mut jobs = st.jobs.lock().unwrap_or_else(|p| p.into_inner());
    let mut done: Vec<(String, i64)> = jobs
        .iter()
        .filter(|(_, j)| j.result.lock().unwrap_or_else(|p| p.into_inner()).is_some())
        .map(|(id, j)| (id.clone(), j.result.lock().unwrap_or_else(|p| p.into_inner()).as_ref().map(|r| r.finished_at).unwrap_or(0)))
        .collect();
    if done.len() <= KEEP_IN_MEMORY {
        return;
    }
    done.sort_by_key(|(_, t)| std::cmp::Reverse(*t));
    for (id, _) in done.into_iter().skip(KEEP_IN_MEMORY) {
        jobs.remove(&id);
    }
}

/// 일시정지 · 다시 · 취소
#[tauri::command]
pub async fn stats_control(app: AppHandle, id: String, action: String) -> Result<(), String> {
    let job = app.state::<StatsState>().jobs.lock().unwrap_or_else(|p| p.into_inner()).get(&id).cloned().ok_or("돌고 있는 작업이 아닙니다")?;
    match action.as_str() {
        "pause" => job.control.pause.store(true, Ordering::Relaxed),
        "resume" => job.control.pause.store(false, Ordering::Relaxed),
        "cancel" => {
            job.control.cancel.store(true, Ordering::Relaxed);
            job.control.pause.store(false, Ordering::Relaxed);
        }
        other => return Err(format!("모르는 동작: {other}")),
    }
    Ok(())
}

/// 작업 목록 — 돌고 있는 것 + 파일로 남은 것 (최근 것부터)
#[tauri::command]
pub async fn stats_jobs(app: AppHandle) -> Result<Vec<JobInfo>, String> {
    let dir = stats_dir(&app).await;
    let mut out = list_saved(&dir);
    let st = app.state::<StatsState>();
    for (id, job) in st.jobs.lock().unwrap_or_else(|p| p.into_inner()).iter() {
        if job.result.lock().unwrap_or_else(|p| p.into_inner()).is_some() || out.iter().any(|j| j.id == *id) {
            continue;
        }
        let p = job.progress.lock().unwrap_or_else(|e| e.into_inner()).clone();
        out.push(JobInfo {
            id: id.clone(),
            title: job.request.title.clone(),
            status: job.status.lock().unwrap_or_else(|e| e.into_inner()).clone(),
            started_at: p.started_at,
            finished_at: 0,
            request: job.request.clone(),
            progress: Some(p),
            services: 0,
        });
    }
    out.sort_by_key(|j| std::cmp::Reverse(j.started_at));
    Ok(out)
}

async fn result_of(app: &AppHandle, id: &str) -> Result<Arc<StatsResult>, String> {
    if let Some(r) = app
        .state::<StatsState>()
        .jobs
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .get(id)
        .and_then(|j| j.result.lock().unwrap_or_else(|p| p.into_inner()).clone())
    {
        return Ok(r);
    }
    let dir = stats_dir(app).await;
    let id = id.to_string();
    let r = tokio::task::spawn_blocking(move || load(&dir, &id)).await.map_err(|e| e.to_string())??;
    Ok(Arc::new(r))
}

/// 비교 표용 결과 — 서비스마다 5분 추이·분포를 뺀 것
#[tauri::command]
pub async fn stats_result(app: AppHandle, id: String) -> Result<StatsResult, String> {
    Ok(compact(&*result_of(&app, &id).await?))
}

/// 서비스 하나의 전부 — 5분 추이·분포까지 (펼쳐 볼 때)
#[tauri::command]
pub async fn stats_service(app: AppHandle, id: String, service: String) -> Result<ServiceStats, String> {
    let r = result_of(&app, &id).await?;
    r.services.iter().find(|s| s.service == service).cloned().ok_or_else(|| format!("결과에 없는 서비스: {service}"))
}

/// 남긴 결과를 지운다 (돌고 있는 작업은 지우지 않는다 — 먼저 취소한다)
#[tauri::command]
pub async fn stats_delete(app: AppHandle, id: String) -> Result<(), String> {
    let st = app.state::<StatsState>();
    {
        let mut jobs = st.jobs.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(j) = jobs.get(&id) {
            if j.result.lock().unwrap_or_else(|p| p.into_inner()).is_none() {
                return Err("돌고 있는 작업입니다 — 먼저 취소하세요".into());
            }
        }
        jobs.remove(&id);
    }
    if !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(format!("잘못된 통계 결과 이름: {id}"));
    }
    let dir = stats_dir(&app).await;
    for p in [result_path(&dir, &id), meta_path(&dir, &id)] {
        let _ = std::fs::remove_file(p);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_result(id: &str) -> StatsResult {
        let mut book = model::Book::default();
        let x = crate::scouter::pack::XLogPack { txid: 1, end_time: 600_000, elapsed: 120, ..Default::default() };
        book.by_service.entry("/a".into()).or_default().0.add(&x, || model::Sample {
            txid: "1".into(),
            date: "20261112".into(),
            end_time: 600_000,
            elapsed: 120,
            error: false,
            obj_hash: 7,
        });
        StatsResult { id: id.into(), status: "done".into(), services: book.finish(60.0, 60.0), ..StatsResult::default() }
    }

    #[test]
    fn 남긴_결과를_다시_읽고_목록에_보인다() {
        let dir = std::env::temp_dir().join(format!("nscouter-stats-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let r = sample_result("123-0");
        save(&dir, &r).unwrap();
        assert_eq!(load(&dir, "123-0").unwrap(), r);
        let list = list_saved(&dir);
        assert_eq!(list.len(), 1);
        assert_eq!((list[0].id.as_str(), list[0].services), ("123-0", 1));
        assert!(load(&dir, "../etc").is_err(), "경로가 섞인 이름은 안 받는다");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 비교_표용_결과는_추이와_분포를_뺀다() {
        let r = sample_result("1-0");
        assert!(!r.services[0].current.as_ref().unwrap().series.is_empty());
        let c = compact(&r);
        let s = c.services[0].current.as_ref().unwrap();
        assert!(s.series.is_empty() && s.dist.is_empty());
        assert_eq!(s.count, 1, "숫자는 그대로");
        assert_eq!(s.slowest.len(), 1, "느린 트랜잭션은 표에서 바로 연다 — 남긴다");
    }
}
