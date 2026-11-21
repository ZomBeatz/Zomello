#![cfg_attr(mobile, allow(dead_code))]
//! People on this computer's boards: a paired phone or tablet can belong to a person ("Sam's phone").
//! That device only gets the boards shared with Sam (a board's `share`: `{ "Sam": "view" | "check" |
//! "edit" | "custom" }`, with details in `shareRules.Sam`), and when it saves, only the changes Sam may
//! make are kept:
//!
//! - **view:** nothing.
//! - **check:** comments on any card; on the cards assigned to Sam, the status and checklist ticks.
//!   Optional extras: pick up unassigned cards, hand their cards to someone, move their cards between buckets.
//! - **custom:** per bucket hidden / see / work in / in charge, and per ability (comment, status, details,
//!   create, archive, pick up, hand off, which priorities they may set).
//! - **edit:** anything on the board (its buckets and cards), except who it's shared with.
//!
//! Everything else (other boards, settings, templates) stays as this computer has it. A device without
//! a person keeps seeing and changing everything, as before. The page shows the same choices in
//! src/components/PeopleAccess.tsx; src/assign.ts uses them to decide who Auto-assign may pick.

use serde_json::{Map, Value};

/// What `person` may do on a board: "view", "check", "edit", "custom", or None (not shared with them).
fn access<'a>(board: &'a Value, person: &str) -> Option<&'a str> {
    board["share"][person].as_str().filter(|a| matches!(*a, "view" | "check" | "edit" | "custom"))
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

/// A bucket as one person sees it.
#[derive(Clone, Copy, PartialEq, PartialOrd, Debug)]
enum Bucket {
    Hidden,
    See,
    Work,
    Lead,
}

fn bucket_of(v: &Value) -> Option<Bucket> {
    match v.as_str()? {
        "hidden" => Some(Bucket::Hidden),
        "see" => Some(Bucket::See),
        "work" => Some(Bucket::Work),
        "lead" => Some(Bucket::Lead),
        _ => None,
    }
}

/// Everything `person` may do on one board (check and custom; view and edit are handled whole).
struct Rules {
    buckets: Map<String, Value>,
    other: Bucket,
    comment: bool,
    /// "none", "own" (cards assigned to them) or "any" (cards in buckets they work in).
    status: String,
    pick_up: bool,
    hand_off: bool,
    move_own: bool,
    details: bool,
    create: bool,
    archive: bool,
    priorities: Option<Vec<String>>,
}

impl Rules {
    fn of(board: &Value, person: &str) -> Rules {
        let r = &board["shareRules"][person];
        let yes = |k: &str| r[k].as_bool().unwrap_or(false);
        let custom = access(board, person) == Some("custom");
        Rules {
            buckets: if custom { r["buckets"].as_object().cloned().unwrap_or_default() } else { Map::new() },
            other: if custom { bucket_of(&r["otherBuckets"]).unwrap_or(Bucket::See) } else { Bucket::See },
            comment: if custom { yes("comment") } else { true },
            status: if custom { r["status"].as_str().unwrap_or("none").to_string() } else { "own".into() },
            pick_up: yes("pickUp"),
            hand_off: yes("handOff"),
            move_own: yes("moveOwn"),
            details: custom && yes("details"),
            create: custom && yes("create"),
            archive: custom && yes("archive"),
            priorities: if custom {
                r["priorities"].as_array().map(|a| a.iter().filter_map(|p| p.as_str().map(str::to_string)).collect())
            } else {
                None
            },
        }
    }

    fn bucket(&self, list: Option<&str>) -> Bucket {
        list.and_then(|l| self.buckets.get(l)).and_then(bucket_of).unwrap_or(self.other)
    }

    fn may_set_priority(&self, p: &Value) -> bool {
        match (&self.priorities, p.as_str()) {
            (None, _) => true,
            (Some(ok), Some(p)) => ok.iter().any(|x| x == p),
            (Some(_), None) => false,
        }
    }
}

/// What `person`'s device sees: their boards (with those boards' buckets, cards and view settings, less
/// any buckets hidden from them), and "me" set to them so My Day and My Tasks are theirs.
pub fn for_person(json: &str, person: &str) -> String {
    let Ok(mut data) = serde_json::from_str::<Value>(json) else { return json.to_string() };
    let boards = shared_boards(&data, person);
    let on = |id: &str| boards.iter().any(|(b, _)| b == id);
    let rules: Vec<(String, Rules)> = boards.iter().map(|(id, _)| (id.clone(), Rules::of(&data["boards"][id], person))).collect();
    let hidden = |board: Option<&str>, list: Option<&str>| {
        rules.iter().find(|(id, _)| Some(id.as_str()) == board).is_some_and(|(_, r)| r.bucket(list) == Bucket::Hidden)
    };
    if let Some(m) = data["lists"].as_object_mut() {
        m.retain(|id, e| e["boardId"].as_str().is_some_and(on) && !hidden(e["boardId"].as_str(), Some(id)));
    }
    if let Some(m) = data["cards"].as_object_mut() {
        m.retain(|_, e| e["boardId"].as_str().is_some_and(on) && !hidden(e["boardId"].as_str(), e["listId"].as_str()));
    }
    if let Some(m) = data["boards"].as_object_mut() {
        m.retain(|id, _| on(id));
    }
    if let Some(m) = data["ui"].as_object_mut() {
        m.retain(|id, _| on(id));
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

fn names(v: &Value) -> Vec<String> {
    v.as_array().into_iter().flatten().filter_map(|x| x.as_str().map(str::to_string)).collect()
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
            for key in ["share", "shareRules", "private", "capacity"] {
                b[key] = old[key].clone();
            }
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

    // Check and custom: card by card, only what the rules allow.
    for (bid, _) in boards.iter().filter(|(_, a)| a == "check" || a == "custom") {
        let rules = Rules::of(&data["boards"][bid], person);
        let on_board = |c: &Value| c["boardId"].as_str() == Some(bid.as_str());
        let lists_here = |l: Option<&str>| l.is_some_and(|l| data["lists"][l]["boardId"].as_str() == Some(bid.as_str()));
        let cur: Map<String, Value> = data["cards"].as_object().into_iter().flatten().filter(|(_, c)| on_board(c)).map(|(k, v)| (k.clone(), v.clone())).collect();
        let new: Map<String, Value> = inc["cards"].as_object().into_iter().flatten().filter(|(_, c)| on_board(c)).map(|(k, v)| (k.clone(), v.clone())).collect();
        let mut changes: Vec<(String, Option<Value>)> = Vec::new();

        for (id, old) in &cur {
            let here = rules.bucket(old["listId"].as_str());
            let Some(n) = new.get(id) else {
                // Gone from the device: archived or deleted there (hidden buckets were never sent, so they stay).
                if rules.archive && here >= Bucket::Work {
                    changes.push((id.clone(), None));
                }
                continue;
            };
            changes.push((id.clone(), Some(merge_card(old, n, &rules, person, &lists_here))));
        }
        for (id, n) in &new {
            if cur.contains_key(id) || data["cards"].get(id).is_some() {
                continue; // existing elsewhere: never taken from another board
            }
            let list = n["listId"].as_str();
            if rules.create && lists_here(list) && rules.bucket(list) >= Bucket::Work && rules.may_set_priority(&n["priority"]) {
                let mut c = n.clone();
                // A new card can be theirs or nobody's, unless they're in charge of the bucket.
                if rules.bucket(list) < Bucket::Lead {
                    let mine = names(&n["assignees"]).iter().any(|p| p == person);
                    c["assignees"] = if mine && rules.pick_up { serde_json::json!([person]) } else { serde_json::json!([]) };
                }
                changes.push((id.clone(), Some(c)));
            }
        }
        let cards = data["cards"].as_object_mut().expect("cards");
        for (id, c) in changes {
            match c {
                Some(c) => cards.insert(id, c),
                None => cards.remove(&id),
            };
        }
    }
    data.to_string()
}

/// One card: the current copy with the changes `person` may make from the device's copy.
fn merge_card(old: &Value, n: &Value, r: &Rules, person: &str, lists_here: &dyn Fn(Option<&str>) -> bool) -> Value {
    let mut c = old.clone();
    let here = r.bucket(old["listId"].as_str());
    if here == Bucket::Hidden {
        return c;
    }
    let was_mine = names(&old["assignees"]).iter().any(|p| p == person);

    // Who it's assigned to.
    if here == Bucket::Lead {
        c["assignees"] = n["assignees"].clone();
    } else {
        let mut a = names(&old["assignees"]);
        let wanted = names(&n["assignees"]);
        if r.pick_up && a.is_empty() && wanted.iter().any(|p| p == person) {
            a = vec![person.to_string()];
        } else if r.hand_off && was_mine && !wanted.iter().any(|p| p == person) {
            a.retain(|p| p != person);
            a.extend(wanted.into_iter().filter(|p| !old["assignees"].as_array().is_some_and(|o| o.iter().any(|x| x == p))));
        }
        c["assignees"] = serde_json::json!(a);
    }
    let mine = names(&c["assignees"]).iter().any(|p| p == person);
    let works_here = here >= Bucket::Work;

    // Status and checklist ticks.
    if (r.status == "own" || r.status == "any") && mine || r.status == "any" && works_here {
        for key in ["progress", "completedAt"] {
            c[key] = n[key].clone();
        }
        if let Some(items) = c["checklist"].as_array_mut() {
            for item in items {
                let done = n["checklist"].as_array().into_iter().flatten().find(|x| x["id"] == item["id"]).map(|x| x["done"].clone());
                if let Some(done) = done {
                    item["done"] = done;
                }
            }
        }
    }

    // Details: what the card says and when.
    if r.details && (works_here || mine) {
        for key in ["title", "description", "startDate", "dueDate", "labelIds", "fields", "cover", "coverImage", "coverSize", "effort", "checklist", "attachments", "recurrence", "estimate"] {
            if n.get(key).is_some() {
                c[key] = n[key].clone();
            }
        }
        if r.may_set_priority(&old["priority"]) && r.may_set_priority(&n["priority"]) {
            c["priority"] = n["priority"].clone();
        }
    }

    // Moving: between buckets they work in, or their own cards anywhere they can see (Check off extra).
    let to = n["listId"].as_str();
    if to != old["listId"].as_str() && lists_here(to) {
        let target = r.bucket(to);
        if works_here && target >= Bucket::Work || r.move_own && mine && target >= Bucket::See {
            c["listId"] = n["listId"].clone();
            c["order"] = n["order"].clone();
        }
    } else if works_here || r.move_own && mine {
        c["order"] = n["order"].clone();
    }

    if r.archive && works_here {
        c["archived"] = n["archived"].clone();
    }

    // New comments only: they can't change or remove anyone's.
    if r.comment {
        let known = ids(&old["comments"]).into_iter().map(str::to_string).collect::<Vec<_>>();
        let added: Vec<Value> = n["comments"].as_array().into_iter().flatten().filter(|x| x["id"].as_str().is_some_and(|i| !known.iter().any(|k| k == i))).cloned().collect();
        if !added.is_empty() {
            let mut all = added;
            all.extend(old["comments"].as_array().cloned().unwrap_or_default());
            c["comments"] = Value::Array(all);
        }
    }

    if c != *old {
        for key in ["activity", "updatedAt"] {
            if n.get(key).is_some() {
                c[key] = n[key].clone();
            }
        }
        // Someone changed who has it: it's no longer Auto-assign's choice.
        if c["assignees"] != old["assignees"] {
            c["autoAssigned"] = Value::Null;
        }
    }
    c
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

    fn custom() -> Value {
        json!({
            "boards": { "home": { "id": "home", "share": { "Sam": "custom", "Kim": "check" },
                "shareRules": {
                    "Sam": { "buckets": { "laundry": "lead", "done": "work", "secret": "hidden" }, "otherBuckets": "see",
                             "comment": true, "status": "own", "details": true, "create": true, "archive": false,
                             "priorities": ["medium", "low"] },
                    "Kim": { "pickUp": true, "handOff": true, "moveOwn": true }
                } } },
            "lists": {
                "laundry": { "id": "laundry", "boardId": "home" }, "done": { "id": "done", "boardId": "home" },
                "kitchen": { "id": "kitchen", "boardId": "home" }, "secret": { "id": "secret", "boardId": "home" }
            },
            "cards": {
                "socks": { "id": "socks", "boardId": "home", "listId": "laundry", "title": "Socks", "assignees": ["Alex"], "priority": "medium", "progress": "notStarted", "order": 0, "comments": [] },
                "sheets": { "id": "sheets", "boardId": "home", "listId": "laundry", "title": "Sheets", "assignees": [], "priority": "urgent", "progress": "notStarted", "order": 1, "comments": [] },
                "pans": { "id": "pans", "boardId": "home", "listId": "kitchen", "title": "Pans", "assignees": [], "priority": "medium", "progress": "notStarted", "order": 0, "comments": [] },
                "gift": { "id": "gift", "boardId": "home", "listId": "secret", "title": "Gift", "assignees": [], "priority": "medium", "order": 0, "comments": [] }
            },
            "settings": { "me": "Owner" }
        })
    }

    fn as_seen(person: &str) -> Value {
        serde_json::from_str(&super::for_person(&custom().to_string(), person)).unwrap()
    }

    fn saved(person: &str, v: &Value) -> Value {
        serde_json::from_str(&super::merge_from_person(&v.to_string(), &custom().to_string(), person)).unwrap()
    }

    #[test]
    fn hidden_buckets_are_never_sent_or_lost() {
        let s = as_seen("Sam");
        assert!(s["lists"].get("secret").is_none() && s["cards"].get("gift").is_none());
        let m = saved("Sam", &s);
        assert_eq!(m["cards"]["gift"]["title"], "Gift");
    }

    #[test]
    fn in_charge_of_a_bucket_reassigns_and_moves_to_buckets_they_work_in() {
        let mut s = as_seen("Sam");
        s["cards"]["socks"]["assignees"] = json!(["Sam"]);
        s["cards"]["socks"]["listId"] = json!("done");
        s["cards"]["sheets"]["listId"] = json!("kitchen"); // kitchen is see-only: not kept
        s["cards"]["pans"]["title"] = json!("Pots"); // see-only bucket, not theirs: not kept
        let m = saved("Sam", &s);
        assert_eq!(m["cards"]["socks"]["assignees"], json!(["Sam"]));
        assert_eq!(m["cards"]["socks"]["listId"], "done");
        assert_eq!(m["cards"]["sheets"]["listId"], "laundry");
        assert_eq!(m["cards"]["pans"]["title"], "Pans");
    }

    #[test]
    fn only_allowed_priorities_and_buckets_for_new_cards() {
        let mut s = as_seen("Sam");
        s["cards"]["sheets"]["priority"] = json!("low"); // it's urgent now, which they may not touch
        s["cards"]["socks"]["priority"] = json!("low");
        s["cards"]["n1"] = json!({ "id": "n1", "boardId": "home", "listId": "laundry", "title": "Towels", "priority": "medium", "assignees": ["Kim"] });
        s["cards"]["n2"] = json!({ "id": "n2", "boardId": "home", "listId": "kitchen", "title": "Plates", "priority": "medium" });
        s["cards"]["n3"] = json!({ "id": "n3", "boardId": "home", "listId": "laundry", "title": "Rugs", "priority": "urgent" });
        s["cards"].as_object_mut().unwrap().remove("pans"); // no archive rights
        let m = saved("Sam", &s);
        assert_eq!(m["cards"]["sheets"]["priority"], "urgent");
        assert_eq!(m["cards"]["socks"]["priority"], "low");
        assert_eq!(m["cards"]["n1"]["assignees"], json!(["Kim"])); // in charge of laundry
        assert!(m["cards"].get("n2").is_none() && m["cards"].get("n3").is_none());
        assert!(m["cards"].get("pans").is_some());
    }

    #[test]
    fn check_off_extras_pick_up_hand_off_and_move() {
        let mut s = as_seen("Kim");
        assert!(s["cards"].get("gift").is_some()); // Check off sees every bucket
        s["cards"]["pans"]["assignees"] = json!(["Kim"]);
        s["cards"]["pans"]["listId"] = json!("done");
        s["cards"]["pans"]["progress"] = json!("completed");
        s["cards"]["socks"]["assignees"] = json!(["Kim"]); // someone else's: can't take it
        let m = saved("Kim", &s);
        assert_eq!(m["cards"]["pans"]["assignees"], json!(["Kim"]));
        assert_eq!(m["cards"]["pans"]["listId"], "done");
        assert_eq!(m["cards"]["pans"]["progress"], "completed");
        assert_eq!(m["cards"]["socks"]["assignees"], json!(["Alex"]));

        // Handing it on to Sam afterwards.
        let after = m.to_string();
        let mut s2: Value = serde_json::from_str(&super::for_person(&after, "Kim")).unwrap();
        s2["cards"]["pans"]["assignees"] = json!(["Sam"]);
        let m2: Value = serde_json::from_str(&super::merge_from_person(&s2.to_string(), &after, "Kim")).unwrap();
        assert_eq!(m2["cards"]["pans"]["assignees"], json!(["Sam"]));
    }
}
