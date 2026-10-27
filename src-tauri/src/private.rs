#![cfg_attr(mobile, allow(dead_code))]
//! Private boards ("Private: only on this device"): never sent anywhere. A phone leaves them out of
//! what it shares with your computer, and the computer leaves its own out of what paired phones and
//! tablets see. When such a device saves, the computer's private boards are kept as they were.

use serde_json::{Map, Value};

/// Ids of private boards, and of the buckets and cards on them.
fn private_ids(data: &Value) -> (Vec<String>, Vec<String>, Vec<String>) {
    let boards: Vec<String> = data["boards"]
        .as_object()
        .into_iter()
        .flatten()
        .filter(|(_, b)| b["private"] == Value::Bool(true))
        .map(|(id, _)| id.clone())
        .collect();
    let on = |kind: &str| -> Vec<String> {
        data[kind]
            .as_object()
            .into_iter()
            .flatten()
            .filter(|(_, e)| e["boardId"].as_str().is_some_and(|b| boards.iter().any(|x| x == b)))
            .map(|(id, _)| id.clone())
            .collect()
    };
    let (lists, cards) = (on("lists"), on("cards"));
    (boards, lists, cards)
}

/// The data without private boards (and their buckets, cards and per-board view settings).
pub fn without_private(json: &str) -> String {
    let Ok(mut data) = serde_json::from_str::<Value>(json) else { return json.to_string() };
    let (boards, lists, cards) = private_ids(&data);
    if boards.is_empty() {
        return json.to_string();
    }
    for (kind, ids) in [("boards", &boards), ("lists", &lists), ("cards", &cards), ("ui", &boards)] {
        if let Some(m) = data[kind].as_object_mut() {
            for id in ids {
                m.remove(id);
            }
        }
    }
    data.to_string()
}

/// Just the private boards (with their buckets, cards and view settings), or None when there are none.
pub fn only_private(json: &str) -> Option<String> {
    let data = serde_json::from_str::<Value>(json).ok()?;
    let (boards, lists, cards) = private_ids(&data);
    if boards.is_empty() {
        return None;
    }
    let mut out = Map::new();
    for (kind, ids) in [("boards", &boards), ("lists", &lists), ("cards", &cards), ("ui", &boards)] {
        let m: Map<String, Value> = ids.iter().filter_map(|id| Some((id.clone(), data[kind].get(id)?.clone()))).collect();
        out.insert(kind.to_string(), Value::Object(m));
    }
    Some(Value::Object(out).to_string())
}

/// `incoming` (saved by a device that never saw the private boards) with `current`'s private boards
/// put back, so a save from a phone can't remove them.
pub fn keep_private(incoming: &str, current: &str) -> String {
    let (Ok(mut data), Ok(cur)) = (serde_json::from_str::<Value>(incoming), serde_json::from_str::<Value>(current)) else {
        return incoming.to_string();
    };
    let (boards, lists, cards) = private_ids(&cur);
    if boards.is_empty() {
        return incoming.to_string();
    }
    for (kind, ids) in [("boards", &boards), ("lists", &lists), ("cards", &cards), ("ui", &boards)] {
        if !data[kind].is_object() {
            data[kind] = Value::Object(Map::new());
        }
        for id in ids {
            if let Some(v) = cur[kind].get(id) {
                data[kind][id] = v.clone();
            }
        }
    }
    data.to_string()
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    fn sample() -> Value {
        json!({
            "boards": { "a": { "id": "a" }, "p": { "id": "p", "private": true } },
            "lists": { "la": { "id": "la", "boardId": "a" }, "lp": { "id": "lp", "boardId": "p" } },
            "cards": { "ca": { "id": "ca", "boardId": "a" }, "cp": { "id": "cp", "boardId": "p" } },
            "ui": { "p": {} }
        })
    }

    #[test]
    fn private_boards_are_left_out() {
        let out: Value = serde_json::from_str(&super::without_private(&sample().to_string())).unwrap();
        assert!(out["boards"].get("p").is_none() && out["lists"].get("lp").is_none() && out["cards"].get("cp").is_none());
        assert!(out["boards"].get("a").is_some() && out["cards"].get("ca").is_some());
        assert!(out["ui"].get("p").is_none());
    }

    #[test]
    fn a_save_from_a_device_keeps_them() {
        let cur = sample().to_string();
        let seen = super::without_private(&cur);
        // The device edited board a and saved what it saw.
        let mut edited: Value = serde_json::from_str(&seen).unwrap();
        edited["boards"]["a"]["title"] = json!("Changed");
        let merged: Value = serde_json::from_str(&super::keep_private(&edited.to_string(), &cur)).unwrap();
        assert_eq!(merged["boards"]["a"]["title"], "Changed");
        assert!(merged["boards"]["p"]["private"] == true && merged["cards"].get("cp").is_some());
    }
}
