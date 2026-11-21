#![cfg_attr(mobile, allow(dead_code))]
//! People on this computer's boards: a paired phone or tablet can belong to a person ("Sam's phone").
//! That device only gets the boards shared with Sam (a board's `share`: `{ "Sam": "view" | "check" |
//! "edit" }`), and when it saves, only the changes Sam may make are kept:
//!
//! - **view:** nothing.
//! - **check:** tick off (and untick) the cards and checklist items assigned to Sam, and add comments
//!   to any card on the board.
//! - **edit:** anything on the board (its buckets and cards), except who it's shared with.
//!
//! Everything else (other boards, settings, templates) stays as this computer has it. A device without
//! a person keeps seeing and changing everything, as before.

use serde_json::{Map, Value};

/// What `person` may do on a board: "view", "check", "edit", or None (not shared with them).
fn access<'a>(board: &'a Value, person: &str) -> Option<&'a str> {
    board["share"][person].as_str().filter(|a| matches!(*a, "view" | "check" | "edit"))
}

fn shared_boards(data: &Value, person: &str) -> Vec<(String, String)> {
    data["boards"]
        .as_object()
        .into_iter()
        .flatten()
        .filter(|(_, b)| b["private"] != Value::Bool(true))
        .filter_map(|(id, b)| Some((id.clone(), access(b, person)?.to_string())))
        .collect()
}

/// What `person`'s device sees: their boards (with those boards' buckets, cards and view settings),
/// and "me" set to them so My Day and My Tasks are theirs.
pub fn for_person(json: &str, person: &str) -> String {
    let Ok(mut data) = serde_json::from_str::<Value>(json) else { return json.to_string() };
    let boards = shared_boards(&data, person);
    let on = |id: &str| boards.iter().any(|(b, _)| b == id);
    if let Some(m) = data["boards"].as_object_mut() {
        m.retain(|id, _| on(id));
    }
    if let Some(m) = data["ui"].as_object_mut() {
        m.retain(|id, _| on(id));
    }
    for kind in ["lists", "cards"] {
        if let Some(m) = data[kind].as_object_mut() {
            m.retain(|_, e| e["boardId"].as_str().is_some_and(on));
        }
    }
    if let Some(f) = data["savedFilters"].as_array_mut() {
        f.retain(|s| s["boardId"].as_str().is_some_and(on));
    }
    if data["settings"].is_object() {
        data["settings"]["me"] = Value::String(person.to_string());
    }
    data["person"] = Value::String(person.to_string());
    data.to_string()
}

fn ids(v: &Value) -> Vec<&str> {
    v.as_array().into_iter().flatten().filter_map(|x| x["id"].as_str()).collect()
}

/// `current` with the changes from `incoming` (a save from `person`'s device) that they may make.
pub fn merge_from_person(incoming: &str, current: &str, person: &str) -> String {
    let (Ok(inc), Ok(mut data)) = (serde_json::from_str::<Value>(incoming), serde_json::from_str::<Value>(current)) else {
        return current.to_string();
    };
    let boards = shared_boards(&data, person);
    let level = |board: Option<&str>| board.and_then(|b| boards.iter().find(|(id, _)| id == b)).map(|(_, a)| a.as_str());
    let editable = |board: Option<&str>| level(board) == Some("edit");

    // Edit: the board itself (but not who it's shared with), and its buckets and cards as the device has them.
    for (id, _) in boards.iter().filter(|(_, a)| a == "edit") {
        if let (Some(new), Some(old)) = (inc["boards"].get(id), data["boards"].get(id)) {
            let mut b = new.clone();
            b["share"] = old["share"].clone();
            b["private"] = old["private"].clone();
            data["boards"][id] = b;
        }
    }
    for kind in ["lists", "cards"] {
        let cur = data[kind].as_object().cloned().unwrap_or_default();
        let new = inc[kind].as_object().cloned().unwrap_or_default();
        let mut out: Map<String, Value> = Map::new();
        for (id, e) in &cur {
            // Kept unless it's on a board they edit and they removed it (or moved it to another board they edit).
            if !editable(e["boardId"].as_str()) || new.contains_key(id) && !editable(new[id]["boardId"].as_str()) {
                out.insert(id.clone(), e.clone());
            }
        }
        for (id, e) in &new {
            // Added or changed on a board they edit, and not taken from a board they can't edit.
            let was = cur.get(id).and_then(|c| c["boardId"].as_str());
            if editable(e["boardId"].as_str()) && (was.is_none() || editable(was)) {
                out.insert(id.clone(), e.clone());
            }
        }
        data[kind] = Value::Object(out);
    }

    // Check: ticking their own cards and checklist items, and comments on any card of the board.
    let cards = data["cards"].as_object().cloned().unwrap_or_default();
    for (id, card) in &cards {
        if level(card["boardId"].as_str()) != Some("check") {
            continue;
        }
        let Some(new) = inc["cards"].get(id) else { continue };
        let mut c = card.clone();
        let theirs = card["assignees"].as_array().is_some_and(|a| a.iter().any(|p| p == person));
        if theirs {
            for key in ["progress", "completedAt"] {
                c[key] = new[key].clone();
            }
            if let Some(items) = c["checklist"].as_array_mut() {
                for item in items {
                    let done = new["checklist"].as_array().into_iter().flatten().find(|n| n["id"] == item["id"]).map(|n| n["done"].clone());
                    if let Some(done) = done {
                        item["done"] = done;
                    }
                }
            }
        }
        // New comments only: they can't change or remove anyone's.
        let known = ids(&card["comments"]).into_iter().map(str::to_string).collect::<Vec<_>>();
        let added: Vec<Value> = new["comments"].as_array().into_iter().flatten().filter(|n| n["id"].as_str().is_some_and(|i| !known.iter().any(|k| k == i))).cloned().collect();
        if !added.is_empty() {
            let mut all = added;
            all.extend(card["comments"].as_array().cloned().unwrap_or_default());
            c["comments"] = Value::Array(all);
        }
        data["cards"][id] = c;
    }
    data.to_string()
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    fn sample() -> Value {
        json!({
            "boards": {
                "chores": { "id": "chores", "title": "Chores", "share": { "Sam": "check" } },
                "trip": { "id": "trip", "title": "Trip", "share": { "Sam": "edit" } },
                "menu": { "id": "menu", "title": "Menu", "share": { "Sam": "view" } },
                "work": { "id": "work", "title": "Work" }
            },
            "lists": {
                "l1": { "id": "l1", "boardId": "chores" }, "l2": { "id": "l2", "boardId": "trip" },
                "l3": { "id": "l3", "boardId": "menu" }, "l4": { "id": "l4", "boardId": "work" }
            },
            "cards": {
                "dishes": { "id": "dishes", "boardId": "chores", "listId": "l1", "title": "Dishes", "assignees": ["Sam"], "progress": "notStarted", "completedAt": null,
                            "checklist": [{ "id": "i1", "text": "Rinse", "done": false }], "comments": [] },
                "lawn": { "id": "lawn", "boardId": "chores", "listId": "l1", "title": "Lawn", "assignees": ["Alex"], "progress": "notStarted", "completedAt": null, "checklist": [], "comments": [] },
                "tickets": { "id": "tickets", "boardId": "trip", "listId": "l2", "title": "Tickets", "assignees": [], "comments": [] },
                "soup": { "id": "soup", "boardId": "menu", "listId": "l3", "title": "Soup", "assignees": [], "comments": [] },
                "taxes": { "id": "taxes", "boardId": "work", "listId": "l4", "title": "Taxes", "assignees": [], "comments": [] }
            },
            "ui": { "chores": {}, "work": {} },
            "savedFilters": [{ "id": "f", "boardId": "work" }],
            "settings": { "me": "Owner", "people": ["Owner", "Sam"] }
        })
    }

    fn seen() -> Value {
        serde_json::from_str(&super::for_person(&sample().to_string(), "Sam")).unwrap()
    }

    fn merged(v: &Value) -> Value {
        serde_json::from_str(&super::merge_from_person(&v.to_string(), &sample().to_string(), "Sam")).unwrap()
    }

    #[test]
    fn a_person_sees_only_their_boards() {
        let s = seen();
        assert!(s["boards"].get("work").is_none() && s["cards"].get("taxes").is_none() && s["lists"].get("l4").is_none());
        assert!(s["boards"].get("chores").is_some() && s["boards"].get("menu").is_some());
        assert!(s["ui"].get("work").is_none() && s["savedFilters"].as_array().unwrap().is_empty());
        assert_eq!(s["settings"]["me"], "Sam");
    }

    #[test]
    fn view_only_changes_are_ignored() {
        let mut s = seen();
        s["cards"]["soup"]["title"] = json!("Changed");
        s["boards"]["menu"]["title"] = json!("Changed");
        let m = merged(&s);
        assert_eq!(m["cards"]["soup"]["title"], "Soup");
        assert_eq!(m["boards"]["menu"]["title"], "Menu");
    }

    #[test]
    fn check_ticks_their_own_cards_and_adds_comments() {
        let mut s = seen();
        s["cards"]["dishes"]["progress"] = json!("completed");
        s["cards"]["dishes"]["checklist"][0]["done"] = json!(true);
        s["cards"]["dishes"]["title"] = json!("Renamed");
        s["cards"]["lawn"]["progress"] = json!("completed");
        s["cards"]["lawn"]["comments"] = json!([{ "id": "c1", "text": "Done tomorrow", "author": "Sam" }]);
        let m = merged(&s);
        assert_eq!(m["cards"]["dishes"]["progress"], "completed");
        assert_eq!(m["cards"]["dishes"]["checklist"][0]["done"], true);
        assert_eq!(m["cards"]["dishes"]["title"], "Dishes");
        assert_eq!(m["cards"]["lawn"]["progress"], "notStarted");
        assert_eq!(m["cards"]["lawn"]["comments"][0]["text"], "Done tomorrow");
    }

    #[test]
    fn edit_changes_adds_and_removes_on_that_board_only() {
        let mut s = seen();
        s["cards"]["tickets"]["title"] = json!("Train tickets");
        s["cards"]["new"] = json!({ "id": "new", "boardId": "trip", "listId": "l2", "title": "Hotel" });
        s["boards"]["trip"]["share"] = json!({ "Sam": "edit", "Alex": "edit" });
        // Trying to move a view-only card onto the board they edit.
        s["cards"]["soup"]["boardId"] = json!("trip");
        let m = merged(&s);
        assert_eq!(m["cards"]["tickets"]["title"], "Train tickets");
        assert_eq!(m["cards"]["new"]["title"], "Hotel");
        assert_eq!(m["boards"]["trip"]["share"], json!({ "Sam": "edit" }));
        assert_eq!(m["cards"]["soup"]["boardId"], "menu");
        // Boards they can't see are untouched.
        assert_eq!(m["cards"]["taxes"]["title"], "Taxes");
        assert_eq!(m["settings"]["me"], "Owner");

        let mut s = seen();
        s["cards"].as_object_mut().unwrap().remove("tickets");
        s["cards"].as_object_mut().unwrap().remove("soup");
        let m = merged(&s);
        assert!(m["cards"].get("tickets").is_none());
        assert!(m["cards"].get("soup").is_some());
    }
}
