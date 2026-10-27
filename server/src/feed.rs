//! Your Zomello dates in your own calendar app: a private link (Settings > Account) that Google Calendar,
//! Outlook or Apple Calendar can subscribe to. It lists the dated cards on every board you can see, with
//! their times, and refreshes whenever the calendar app checks it.
//!
//! The link's secret is the only thing that opens it (calendar apps can't sign in), so it's stored hashed,
//! like sessions, and making a new link turns the old one off.

use crate::{auth, civil_from_days, err, now, random_hex, sha256_hex, App, ApiResult};
use axum::{
    extract::{Path as UrlPath, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};

/// `GET /api/me/calendar-link`: whether you have one (its secret can't be shown again).
pub async fn status(State(app): State<App>, headers: HeaderMap) -> ApiResult {
    let user = auth::require(&app, &headers)?;
    let db = app.db.lock().unwrap();
    let created: Option<i64> = db
        .query_row("SELECT created FROM calendar_links WHERE user_id = ?", [&user.id], |r| r.get(0))
        .optional()
        .unwrap_or(None);
    Ok(Json(json!({ "on": created.is_some(), "created": created })).into_response())
}

/// `POST /api/me/calendar-link`: a new link (any old one stops working). Returns its path.
pub async fn create(State(app): State<App>, headers: HeaderMap) -> ApiResult {
    let user = auth::require(&app, &headers)?;
    let token = random_hex(24);
    let db = app.db.lock().unwrap();
    db.execute("DELETE FROM calendar_links WHERE user_id = ?", [&user.id]).map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    db.execute("INSERT INTO calendar_links (token_hash, user_id, created) VALUES (?, ?, ?)", params![sha256_hex(&token), user.id, now()])
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    Ok(Json(json!({ "path": format!("/calendar/{token}.ics") })).into_response())
}

/// `DELETE /api/me/calendar-link`: turn it off.
pub async fn remove(State(app): State<App>, headers: HeaderMap) -> ApiResult {
    let user = auth::require(&app, &headers)?;
    let db = app.db.lock().unwrap();
    let _ = db.execute("DELETE FROM calendar_links WHERE user_id = ?", [&user.id]);
    Ok(StatusCode::NO_CONTENT.into_response())
}

/// `GET /calendar/<secret>.ics`: the calendar itself.
pub async fn calendar(State(app): State<App>, UrlPath(file): UrlPath<String>) -> Response {
    let Some(token) = file.strip_suffix(".ics") else { return StatusCode::NOT_FOUND.into_response() };
    let db = app.db.lock().unwrap();
    let user: Option<String> = db
        .query_row(
            "SELECT l.user_id FROM calendar_links l JOIN users u ON u.id = l.user_id WHERE l.token_hash = ? AND u.disabled = 0",
            [sha256_hex(token)],
            |r| r.get(0),
        )
        .optional()
        .unwrap_or(None);
    let Some(user) = user else { return StatusCode::NOT_FOUND.into_response() };
    let mut boards = Vec::new();
    let mut lists = Vec::new();
    let mut cards = Vec::new();
    let mut st = db.prepare("SELECT b.data FROM boards b JOIN members m ON m.board_id = b.id WHERE m.user_id = ?").unwrap();
    for data in st.query_map([&user], |r| r.get::<_, String>(0)).unwrap().flatten() {
        if let Ok(b) = serde_json::from_str::<Value>(&data) {
            boards.push(b);
        }
    }
    for (table, out) in [("lists", &mut lists), ("cards", &mut cards)] {
        let mut st = db
            .prepare(&format!("SELECT t.data FROM {table} t JOIN members m ON m.board_id = t.board_id WHERE m.user_id = ?"))
            .unwrap();
        for data in st.query_map([&user], |r| r.get::<_, String>(0)).unwrap().flatten() {
            if let Ok(v) = serde_json::from_str::<Value>(&data) {
                out.push(v);
            }
        }
    }
    drop(st);
    drop(db);
    let body = ics(&boards, &lists, &cards, now());
    ([(header::CONTENT_TYPE, "text/calendar; charset=utf-8"), (header::CACHE_CONTROL, "no-store")], body).into_response()
}

// ---- The calendar file ----

/// "2026-10-28" → days since 1970-01-01.
fn days_from(date: &str) -> Option<i64> {
    let mut it = date.split('-');
    let (y, m, d): (i64, i64, i64) = (it.next()?.parse().ok()?, it.next()?.parse().ok()?, it.next()?.parse().ok()?);
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some(era * 146_097 + doe - 719_468)
}

fn ymd(days: i64) -> String {
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}{m:02}{d:02}")
}

/// "15:30" → minutes after midnight.
fn minutes(t: &str) -> Option<i64> {
    let (h, m) = t.split_once(':')?;
    let (h, m): (i64, i64) = (h.parse().ok()?, m.parse().ok()?);
    (h < 24 && m < 60).then_some(h * 60 + m)
}

/// Local date and time (no time zone: calendar apps show it in the reader's own), `20261028T153000`.
fn local(days: i64, mins: i64) -> String {
    let days = days + mins.div_euclid(1440);
    let m = mins.rem_euclid(1440);
    format!("{}T{:02}{:02}00", ymd(days), m / 60, m % 60)
}

/// Text in a calendar line: backslashes, commas, semicolons and line breaks escaped.
fn text(s: &str) -> String {
    s.replace('\\', "\\\\").replace(';', "\\;").replace(',', "\\,").replace("\r\n", "\\n").replace('\n', "\\n")
}

/// Calendar lines are at most 75 bytes; longer ones continue on the next line after a space.
fn fold(line: &str) -> String {
    let mut out = String::new();
    let mut len = 0;
    for ch in line.chars() {
        let w = ch.len_utf8();
        if len + w > 75 {
            out.push_str("\r\n ");
            len = 1;
        }
        out.push(ch);
        len += w;
    }
    out.push_str("\r\n");
    out
}

/// One event per dated card that isn't done or archived, with the same start and end as Zomello's calendar.
pub fn ics(boards: &[Value], lists: &[Value], cards: &[Value], stamp_secs: i64) -> String {
    let stamp = {
        let s = stamp_secs.rem_euclid(86_400);
        format!("{}T{:02}{:02}{:02}Z", ymd(stamp_secs.div_euclid(86_400)), s / 3600, s % 3600 / 60, s % 60)
    };
    let mut out = String::new();
    for l in ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ZomBeatz Media//Zomello//EN", "CALSCALE:GREGORIAN", "X-WR-CALNAME:Zomello"] {
        out.push_str(&fold(l));
    }
    let board_of = |id: &Value| boards.iter().find(|b| b["id"] == *id);
    for c in cards {
        let Some(b) = board_of(&c["boardId"]) else { continue };
        if c["archived"] == true || b["archived"] == true || c["progress"] == "completed" {
            continue;
        }
        let list = lists.iter().find(|l| l["id"] == c["listId"]);
        if list.is_some_and(|l| l["archived"] == true) {
            continue;
        }
        let (start, due) = (c["startDate"].as_str(), c["dueDate"].as_str());
        let (Some(first), Some(last)) = (start.or(due).and_then(days_from), due.or(start).and_then(days_from)) else { continue };
        let st = c["startTime"].as_str().and_then(minutes);
        let dt = c["dueTime"].as_str().and_then(minutes);
        let same = first == last;
        let (dtstart, dtend) = match (st, dt) {
            (None, None) => (format!("DTSTART;VALUE=DATE:{}", ymd(first)), format!("DTEND;VALUE=DATE:{}", ymd(last + 1))),
            (Some(s), Some(e)) => {
                let (a, mut b) = (first * 1440 + s, last * 1440 + e);
                if b <= a {
                    b = a + 30;
                }
                (format!("DTSTART:{}", local(0, a)), format!("DTEND:{}", local(0, b)))
            }
            (Some(s), None) => {
                let a = first * 1440 + s;
                (format!("DTSTART:{}", local(0, a)), format!("DTEND:{}", local(0, if same { a + 60 } else { (last + 1) * 1440 })))
            }
            (None, Some(e)) => {
                let b = last * 1440 + e;
                (format!("DTSTART:{}", local(0, if same { b - 30 } else { first * 1440 })), format!("DTEND:{}", local(0, b)))
            }
        };
        let where_ = format!("{} › {}", b["title"].as_str().unwrap_or("Board"), list.and_then(|l| l["title"].as_str()).unwrap_or(""));
        let desc: String = c["description"].as_str().unwrap_or("").chars().take(800).collect();
        let id = c["id"].as_str().unwrap_or("card");
        for l in [
            "BEGIN:VEVENT".to_string(),
            format!("UID:{id}@zomello"),
            format!("DTSTAMP:{stamp}"),
            dtstart,
            dtend,
            format!("SUMMARY:{}", text(c["title"].as_str().unwrap_or("Task"))),
            format!("DESCRIPTION:{}", text(&if desc.is_empty() { where_.clone() } else { format!("{where_}\n\n{desc}") })),
            format!("CATEGORIES:{}", text(b["title"].as_str().unwrap_or("Zomello"))),
            "END:VEVENT".to_string(),
        ] {
            out.push_str(&fold(&l));
        }
    }
    out.push_str(&fold("END:VCALENDAR"));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dates_round_trip() {
        for d in ["1970-01-01", "2026-10-28", "2024-02-29", "2027-01-03"] {
            let n = days_from(d).unwrap();
            assert_eq!(ymd(n), d.replace('-', ""));
        }
        assert_eq!(ymd(days_from("2026-12-31").unwrap() + 1), "20270101");
    }

    #[test]
    fn makes_events_like_the_calendar() {
        let boards = vec![json!({ "id": "b", "title": "Home" })];
        let lists = vec![json!({ "id": "l", "boardId": "b", "title": "To do" })];
        let cards = vec![
            json!({ "id": "a", "boardId": "b", "listId": "l", "title": "Dentist, again", "dueDate": "2026-10-28", "startTime": "15:00", "dueTime": "16:00" }),
            json!({ "id": "c", "boardId": "b", "listId": "l", "title": "Paint", "startDate": "2026-10-28", "dueDate": "2026-10-30" }),
            json!({ "id": "d", "boardId": "b", "listId": "l", "title": "Done one", "dueDate": "2026-10-28", "progress": "completed" }),
            json!({ "id": "e", "boardId": "b", "listId": "l", "title": "No date" }),
        ];
        let ics = ics(&boards, &lists, &cards, 0);
        assert!(ics.contains("SUMMARY:Dentist\\, again"));
        assert!(ics.contains("DTSTART:20261028T150000") && ics.contains("DTEND:20261028T160000"));
        assert!(ics.contains("DTSTART;VALUE=DATE:20261028") && ics.contains("DTEND;VALUE=DATE:20261031"));
        assert!(!ics.contains("Done one") && !ics.contains("No date"));
        assert!(ics.lines().all(|l| l.len() <= 76));
    }
}
