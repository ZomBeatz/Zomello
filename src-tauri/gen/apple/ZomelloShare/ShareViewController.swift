// "Add to Zomello" in the share sheet (iPhone and iPad): text or a link becomes a new task. It's left in the
// shared app group folder, and Zomello opens Quick add with it the next time it's opened (src/shareIn.ts →
// share_inbox_take in apple_group.rs). Share extensions can't open their app themselves.

import Social
import UIKit
import UniformTypeIdentifiers

private let group = "group.com.zombeatz.zomello"

class ShareViewController: SLComposeServiceViewController {
  override func isContentValid() -> Bool { true }

  override func viewDidLoad() {
    super.viewDidLoad()
    title = "Add to Zomello"
    navigationController?.navigationBar.topItem?.rightBarButtonItem?.title = "Add"
  }

  override func didSelectPost() {
    let text = (contentText ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    let item = extensionContext?.inputItems.first as? NSExtensionItem
    let link = item?.attachments?.first { $0.hasItemConformingToTypeIdentifier(UTType.url.identifier) }
    let finish: (String?) -> Void = { url in
      // Same shape as Android's share (MainActivity.keepShared): a link with its page title as the subject.
      let entry: [String: String] = url.map { ["text": $0, "subject": text] } ?? ["text": text, "subject": ""]
      Self.save(entry)
      self.extensionContext?.completeRequest(returningItems: nil)
    }
    if let link = link {
      link.loadItem(forTypeIdentifier: UTType.url.identifier) { obj, _ in
        DispatchQueue.main.async { finish((obj as? URL)?.absoluteString) }
      }
    } else {
      finish(nil)
    }
  }

  override func configurationItems() -> [Any]! { [] }

  private static func save(_ entry: [String: String]) {
    guard let dir = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)?.appendingPathComponent("inbox") else { return }
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    guard let data = try? JSONSerialization.data(withJSONObject: entry) else { return }
    try? data.write(to: dir.appendingPathComponent("\(Int(Date().timeIntervalSince1970 * 1000))-\(UUID().uuidString).json"))
  }
}
