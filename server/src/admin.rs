//! The admin menu: create and manage accounts, see and manage every board (owner, members, delete),
//! server info, and backups.

use crate::{auth, db, err, now, random_hex, sharing, App, ApiResult, Event};
use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use rusqlite::{params, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};

/// GET /api/admin/users
pub async fn users(State(app): State<App>, headers: HeaderMap) -> ApiResult {
    auth::require_admin(&app, &headers)?;
    let db = app.db.lock().unwrap();
    let out: Vec<Value> = db::all_users(&db)
        .unwrap_or_default()
        .into_iter()
        .map(|u| {
            let boards: i64 = db.query_row("SELECT COUNT(*) FROM members WHERE user_id = ?", [&u.id], |r| r.get(0)).unwrap_or(0);
            let owned: i64 = db.query_row("SELECT COUNT(*) FROM boards WHERE owner_id = ?", [&u.id], |r| r.get(0)).unwrap_or(0);
            let mut v = serde_json::to_value(&u).unwrap();
            v["boards"] = json!(boards);
            v["ownedBoards"] = json!(owned);
            v
        })
        .collect();
    Ok(Json(out).into_response())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewUser {
    username: String,
    display_name: String,
    password: String,
    #[serde(default)]
    is_admin: bool,
}

/// POST /api/admin/users: create an account (share the username and password with the person).
pub async fn create_user(State(app): State<App>, headers: HeaderMap, Json(req): Json<NewUser>) -> ApiResult {
    auth::require_admin(&app, &headers)?;
    let username = auth::check_username(&req.username)?;
    auth::check_password_rules(&req.password)?;
    let name = req.display_name.trim();
    let db = app.db.lock().unwrap();
    if db::user_by_name(&db, &username).ok().flatten().is_some() {
        return Err(err(StatusCode::CONFLICT, "That username is taken."));
    }
    let id = random_hex(12);
    db.execute(
        "INSERT INTO users (id, username, display_name, pass_hash, is_admin, created) VALUES (?, ?, ?, ?, ?, ?)",
        params![id, username, if name.is_empty() { &username } else { name }, auth::hash_password(&req.password), req.is_admin as i64, now()],
    )
    .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    Ok(Json(json!({ "id": id })).into_response())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserPatch {
    display_name: Option<String>,
    is_admin: Option<bool>,
    disabled: Option<bool>,
    password: Option<String>,
}

/// PATCH /api/admin/users/{id}: rename, make/unmake admin, turn off/on, set a new password.
pub async fn update_user(State(app): State<App>, headers: HeaderMap, Path(id): Path<String>, Json(req): Json<UserPatch>) -> ApiResult {
    let me = auth::require_admin(&app, &headers)?;
    let target = db::user_by_id(&app.db.lock().unwrap(), &id).ok().flatten().ok_or_else(|| err(StatusCode::NOT_FOUND, "No such user"))?;
    if id == me.id && (req.is_admin == Some(false) || req.disabled == Some(true)) {
        return Err(err(StatusCode::BAD_REQUEST, "You can't remove your own admin rights or turn off your own account."));
    }
    if let Some(name) = req.display_name.as_deref().map(str::trim).filter(|n| !n.is_empty() && *n != target.display_name) {
        crate::sync::rename_person(&app, &id, &target.display_name, name)?;
    }
    let mut signout = false;
    {
        let db = app.db.lock().unwrap();
        if let Some(a) = req.is_admin {
            db.execute("UPDATE users SET is_admin = ? WHERE id = ?", params![a as i64, id]).ok();
        }
        if let Some(d) = req.disabled {
            db.execute("UPDATE users SET disabled = ? WHERE id = ?", params![d as i64, id]).ok();
            if d {
                db.execute("DELETE FROM sessions WHERE user_id = ?", [&id]).ok();
                signout = true;
            }
        }
        if let Some(pw) = &req.password {
            auth::check_password_rules(pw)?;
            db.execute("UPDATE users SET pass_hash = ? WHERE id = ?", params![auth::hash_password(pw), id]).ok();
            db.execute("DELETE FROM sessions WHERE user_id = ?", [&id]).ok();
            signout = true;
        }
    }
    if signout {
        app.send(Event { users: vec![id], kind: "signout", from: String::new(), json: "{}".into() });
    }
    Ok("ok".into_response())
}

/// DELETE /api/admin/users/{id}: remove an account. Boards they own go to you (the admin), so
/// nobody else loses access to shared work.
pub async fn delete_user(State(app): State<App>, headers: HeaderMap, Path(id): Path<String>) -> ApiResult {
    let me = auth::require_admin(&app, &headers)?;
    if id == me.id {
        return Err(err(StatusCode::BAD_REQUEST, "You can't delete your own account."));
    }
    let owned: Vec<String> = {
        let db = app.db.lock().unwrap();
        let mut st = db.prepare("SELECT id FROM boards WHERE owner_id = ?").unwrap();
        let ids = st.query_map([&id], |r| r.get(0)).unwrap().flatten().collect();
        ids
    };
    for b in &owned {
        sharing::set_owner(&app, b, &me.id, None)?;
    }
    {
        let db = app.db.lock().unwrap();
        db.execute("DELETE FROM users WHERE id = ?", [&id]).map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    }
    app.send(Event { users: vec![id], kind: "signout", from: String::new(), json: "{}".into() });
    Ok(Json(json!({ "boardsMovedToYou": owned.len() })).into_response())
}

/// GET /api/admin/boards: every board, with owner, members and counts.
pub async fn boards(State(app): State<App>, headers: HeaderMap) -> ApiResult {
    auth::require_admin(&app, &headers)?;
    let db = app.db.lock().unwrap();
    let mut st = db.prepare("SELECT id, owner_id, data, updated FROM boards").unwrap();
    let rows: Vec<(String, String, String, i64)> = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).unwrap().flatten().collect();
    let mut out: Vec<Value> = rows
        .into_iter()
        .map(|(id, owner, data, updated)| {
            let v: Value = serde_json::from_str(&data).unwrap_or(json!({}));
            let cards: i64 = db.query_row("SELECT COUNT(*) FROM cards WHERE board_id = ?", [&id], |r| r.get(0)).unwrap_or(0);
            json!({
                "id": id,
                "title": v.get("title").cloned().unwrap_or(json!("(untitled)")),
                "color": v.get("color").cloned().unwrap_or(json!("#888")),
                "archived": v.get("archived").cloned().unwrap_or(json!(false)),
                "ownerId": owner,
                "members": db::members(&db, &id).unwrap_or_default(),
                "cards": cards,
                "updated": updated,
            })
        })
        .collect();
    out.sort_by(|a, b| a["title"].as_str().unwrap_or("").to_lowercase().cmp(&b["title"].as_str().unwrap_or("").to_lowercase()));
    Ok(Json(out).into_response())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardOwner {
    owner_id: String,
}

/// PATCH /api/admin/boards/{id}: give a board to someone.
pub async fn set_board_owner(State(app): State<App>, headers: HeaderMap, Path(id): Path<String>, Json(req): Json<BoardOwner>) -> ApiResult {
    auth::require_admin(&app, &headers)?;
    sharing::set_owner(&app, &id, &req.owner_id, None)?;
    Ok("ok".into_response())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddMember {
    user_id: String,
}

/// POST /api/admin/boards/{id}/members: add someone to a board directly (no invitation).
pub async fn add_member(State(app): State<App>, headers: HeaderMap, Path(id): Path<String>, Json(req): Json<AddMember>) -> ApiResult {
    auth::require_admin(&app, &headers)?;
    let users = {
        let db = app.db.lock().unwrap();
        if db::board_owner(&db, &id).ok().flatten().is_none() {
            return Err(err(StatusCode::NOT_FOUND, "No such board"));
        }
        db.execute("INSERT OR IGNORE INTO members (board_id, user_id, role, added) VALUES (?, ?, 'member', ?)", params![id, req.user_id, now()])
            .map_err(|e| err(StatusCode::BAD_REQUEST, &e.to_string()))?;
        db.execute("DELETE FROM invites WHERE board_id = ? AND to_user = ?", params![id, req.user_id]).ok();
        db::member_ids(&db, &id).unwrap_or_default()
    };
    app.send(Event { users, kind: "reload", from: String::new(), json: "{}".into() });
    Ok("ok".into_response())
}

/// DELETE /api/admin/boards/{id}: delete a board for everyone.
pub async fn delete_board(State(app): State<App>, headers: HeaderMap, Path(id): Path<String>) -> ApiResult {
    auth::require_admin(&app, &headers)?;
    let users = {
        let db = app.db.lock().unwrap();
        let users = db::member_ids(&db, &id).unwrap_or_default();
        db.execute("DELETE FROM boards WHERE id = ?", [&id]).ok();
        users
    };
    app.send(Event { users, kind: "reload", from: String::new(), json: "{}".into() });
    Ok("ok".into_response())
}

/// GET /api/admin/info: version, counts, where the data lives and how big it is.
pub async fn info(State(app): State<App>, headers: HeaderMap) -> ApiResult {
    auth::require_admin(&app, &headers)?;
    let db = app.db.lock().unwrap();
    let count = |sql: &str| db.query_row(sql, [], |r| r.get::<_, i64>(0)).unwrap_or(0);
    let size = |p: &std::path::Path| std::fs::metadata(p).map(|m| m.len()).unwrap_or(0);
    let attach_bytes: u64 = walk_size(&app.config.data_dir.join("attachments"));
    let backups = list_backups(&app);
    Ok(Json(json!({
        "version": env!("CARGO_PKG_VERSION"),
        "users": count("SELECT COUNT(*) FROM users"),
        "boards": count("SELECT COUNT(*) FROM boards"),
        "cards": count("SELECT COUNT(*) FROM cards"),
        "sessions": count("SELECT COUNT(*) FROM sessions"),
        "dataDir": app.config.data_dir.to_string_lossy(),
        "dbBytes": size(&app.config.data_dir.join("zomello.db")),
        "attachmentBytes": attach_bytes,
        "backups": backups,
        "publicUrl": app.config.public_url,
        "selfCert": app.config.self_cert,
    }))
    .into_response())
}

fn walk_size(p: &std::path::Path) -> u64 {
    std::fs::read_dir(p)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| {
            let path = e.path();
            if path.is_dir() { walk_size(&path) } else { e.metadata().map(|m| m.len()).unwrap_or(0) }
        })
        .sum()
}

pub fn list_backups(app: &App) -> Vec<Value> {
    let mut v: Vec<Value> = std::fs::read_dir(app.config.data_dir.join("backups"))
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            name.ends_with(".db").then(|| json!({ "name": name, "bytes": e.metadata().map(|m| m.len()).unwrap_or(0) }))
        })
        .collect();
    v.sort_by(|a, b| b["name"].as_str().cmp(&a["name"].as_str()));
    v
}

/// A consistent copy of the database (taken while running), into the backups folder.
pub fn snapshot(app: &App, name: &str) -> Result<std::path::PathBuf, String> {
    let dir = app.config.data_dir.join("backups");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(name);
    let _ = std::fs::remove_file(&path);
    app.db.lock().unwrap().execute("VACUUM INTO ?", [path.to_string_lossy().to_string()]).map_err(|e| e.to_string())?;
    Ok(path)
}

/// GET /api/admin/backup: download a fresh copy of the database (attachments live in the data folder).
pub async fn backup(State(app): State<App>, headers: HeaderMap) -> ApiResult {
    auth::require_admin(&app, &headers)?;
    let name = format!("zomello-manual-{}.db", crate::stamp());
    let path = snapshot(&app, &name).map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?;
    let bytes = tokio::fs::read(&path).await.map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    Ok((
        [(header::CONTENT_TYPE, "application/vnd.sqlite3".to_string()), (header::CONTENT_DISPOSITION, format!("attachment; filename=\"{name}\""))],
        Body::from(bytes),
    )
        .into_response())
}

/// Sessions for a user (admin view): when and from what.
pub async fn sessions(State(app): State<App>, headers: HeaderMap, Path(id): Path<String>) -> ApiResult {
    auth::require_admin(&app, &headers)?;
    let db = app.db.lock().unwrap();
    let mut st = db.prepare("SELECT created, last_seen, agent FROM sessions WHERE user_id = ? ORDER BY last_seen DESC").unwrap();
    let out: Vec<Value> = st
        .query_map([&id], |r| Ok(json!({ "created": r.get::<_, i64>(0)?, "lastSeen": r.get::<_, i64>(1)?, "agent": r.get::<_, Option<String>>(2)? })))
        .unwrap()
        .flatten()
        .collect();
    let _ = db.query_row("SELECT 1", [], |_| Ok(())).optional();
    Ok(Json(out).into_response())
}
