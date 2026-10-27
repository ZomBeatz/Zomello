// The My Day home-screen widget for iPhone and iPad. Zomello writes today's and tomorrow's My Day to the
// shared app group folder (src/widget.ts → widget_update in apple_group.rs); this shows the one for today.
// Tapping it opens Zomello.

import SwiftUI
import WidgetKit

private let group = "group.com.zombeatz.zomello"

struct Item: Decodable, Hashable {
  let title: String
  let when: String
  let late: Bool
  let board: String
}

private struct Feed: Decodable {
  let days: [String: [Item]]
}

struct DayEntry: TimelineEntry {
  let date: Date
  /// nil: Zomello hasn't written this day yet.
  let items: [Item]?
}

private func dayKey(_ d: Date) -> String {
  let f = DateFormatter()
  f.calendar = Calendar(identifier: .gregorian)
  f.locale = Locale(identifier: "en_US_POSIX")
  f.timeZone = .current
  f.dateFormat = "yyyy-MM-dd"
  return f.string(from: d)
}

private func load() -> Feed? {
  guard
    let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)?.appendingPathComponent("widget.json"),
    let data = try? Data(contentsOf: url)
  else { return nil }
  return try? JSONDecoder().decode(Feed.self, from: data)
}

struct Provider: TimelineProvider {
  private func entry(at d: Date, _ feed: Feed?) -> DayEntry { DayEntry(date: d, items: feed?.days[dayKey(d)]) }

  func placeholder(in context: Context) -> DayEntry {
    DayEntry(date: Date(), items: [
      Item(title: "Team check-in", when: "10:00 AM", late: false, board: "Work"),
      Item(title: "Groceries", when: "", late: false, board: "Home"),
    ])
  }

  func getSnapshot(in context: Context, completion: @escaping (DayEntry) -> Void) {
    completion(context.isPreview ? placeholder(in: context) : entry(at: Date(), load()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<DayEntry>) -> Void) {
    let feed = load()
    let now = Date()
    // Today now, tomorrow from midnight; look again in 15 minutes for changes made in Zomello.
    let midnight = Calendar.current.startOfDay(for: now.addingTimeInterval(86_400))
    completion(Timeline(entries: [entry(at: now, feed), entry(at: midnight, feed)], policy: .after(now.addingTimeInterval(15 * 60))))
  }
}

private let blue = Color(red: 0.31, green: 0.69, blue: 0.93)
private let red = Color(red: 0.97, green: 0.44, blue: 0.44)

struct MyDayView: View {
  let entry: DayEntry
  @Environment(\.widgetFamily) private var family

  private var limit: Int {
    switch family {
    case .systemSmall: return 3
    case .systemMedium: return 4
    default: return 10
    }
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text("My Day").font(.headline).foregroundColor(blue)
      if let items = entry.items {
        if items.isEmpty {
          Text("Nothing planned today.").font(.footnote).foregroundColor(.secondary)
        }
        ForEach(items.prefix(limit), id: \.self) { item in
          HStack(spacing: 6) {
            if !item.when.isEmpty {
              Text(item.when).font(.caption).foregroundColor(item.late ? red : blue)
            }
            Text(item.title).font(.subheadline).lineLimit(1)
            if family != .systemSmall && !item.board.isEmpty {
              Text(item.board).font(.caption).foregroundColor(.secondary).lineLimit(1)
            }
          }
        }
        if items.count > limit {
          Text("+\(items.count - limit) more").font(.caption).foregroundColor(.secondary)
        }
      } else {
        Text("Open Zomello to bring My Day up to date.").font(.footnote).foregroundColor(.secondary)
      }
      Spacer(minLength: 0)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .widgetBackground()
  }
}

private extension View {
  /// iOS 17 wants the widget's background declared; older versions use a plain padding.
  @ViewBuilder func widgetBackground() -> some View {
    if #available(iOSApplicationExtension 17.0, *) {
      containerBackground(for: .widget) { Color(UIColor.systemBackground) }
    } else {
      padding()
    }
  }
}

@main
struct MyDayWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "MyDay", provider: Provider()) { entry in
      MyDayView(entry: entry)
    }
    .configurationDisplayName("My Day")
    .description("What's late, due and planned today, from every Zomello board.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
  }
}
