import AppKit
import ApplicationServices
import CryptoKit
import Foundation

// A bounded, read-only helper. Only the desktop app launches it; stdout is JSON.
// No keyboard events, clipboard access, message composer changes or send actions.
struct Failure: Error { let code: String; init(_ code: String) { self.code = code } }
func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}
func string(_ element: AXUIElement, _ name: String) -> String { attribute(element, name) as? String ?? "" }
func children(_ element: AXUIElement) -> [AXUIElement] { attribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? [] }
func role(_ element: AXUIElement) -> String { string(element, kAXRoleAttribute) }
func one(_ values: [AXUIElement], _ code: String = "MAC_UI_CHANGED") throws -> AXUIElement {
    guard values.count == 1 else { throw Failure(code) }; return values[0]
}
func run(_ executable: String, _ args: [String]) throws -> String {
    let process = Process(), output = Pipe()
    process.executableURL = URL(fileURLWithPath: executable); process.arguments = args
    process.standardOutput = output; process.standardError = FileHandle.nullDevice
    try process.run()
    let data = output.fileHandleForReading.readDataToEndOfFile(); process.waitUntilExit()
    guard process.terminationStatus == 0 else { throw Failure("ACCOUNT_UNAVAILABLE") }
    return String(decoding: data, as: UTF8.self)
}
func digest(_ text: String) -> String { SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined() }
func matches(_ value: String, _ pattern: String) -> Bool { value.range(of: pattern, options: .regularExpression) != nil }
func roomName(_ label: String) -> String { label.components(separatedBy: ", ").first ?? "" }
func roomType(_ label: String) -> String { matches(label, #", \d+人(?:, |$)"#) ? "group" : "direct" }

final class Reader {
    let application: NSRunningApplication
    let app: AXUIElement
    let version: String
    let previousApplication = NSWorkspace.shared.frontmostApplication
    init() throws {
        let apps = NSRunningApplication.runningApplications(withBundleIdentifier: "jp.naver.line.mac")
        guard apps.count == 1, let candidate = apps.first,
              let url = candidate.bundleURL, let bundle = Bundle(url: url),
              candidate.executableURL?.lastPathComponent == "LINE" else { throw Failure("LINE_NOT_RUNNING") }
        application = candidate
        version = bundle.infoDictionary?["CFBundleShortVersionString"] as? String ?? ""
        app = AXUIElementCreateApplication(candidate.processIdentifier)
        AXUIElementSetMessagingTimeout(app, 1.0)
    }
    func account() throws -> String {
        // Bind to the running LINE session and its actually-open account databases,
        // not stale files from other accounts. Never read/decrypt their contents.
        let listing = try run("/usr/sbin/lsof", ["-a", "-p", String(application.processIdentifier), "-Fn"])
        let files = Set(listing.split(separator: "\n").filter { $0.hasPrefix("n/") && $0.hasSuffix(".edb") }.map(String.init)).sorted()
        guard !files.isEmpty else { throw Failure("ACCOUNT_UNAVAILABLE") }
        return "sender:" + digest("mac-account-v1\n" + files.joined(separator: "\n")).prefix(24)
    }
    func session() throws -> String {
        guard let launched = application.launchDate else { throw Failure("ACCOUNT_UNAVAILABLE") }
        return "session:" + digest("mac-session-v1\n\(application.processIdentifier)\n\(launched.timeIntervalSince1970)").prefix(24)
    }
    func context() throws -> (AXUIElement, AXUIElement) {
        guard AXIsProcessTrusted() else { throw Failure("MAC_ACCESSIBILITY_REQUIRED") }
        guard version == "26.6.0" else { throw Failure("LINE_BUILD_UNVERIFIED") }
        let windows = attribute(app, kAXWindowsAttribute) as? [AXUIElement] ?? []
        let mains = windows.filter { string($0, kAXTitleAttribute) == "LINE" && string($0, kAXSubroleAttribute) == kAXStandardWindowSubrole }
        guard mains.count == 1 else { throw Failure("MAC_LOGIN_REQUIRED") }
        let main = mains[0]
        return (main, try one(children(main).filter { role($0) == kAXSplitGroupRole }))
    }
    func activate() throws {
        guard application.activate(options: [.activateIgnoringOtherApps]) else { throw Failure("MAC_UI_BUSY") }
        Thread.sleep(forTimeInterval: 0.25)
    }
    func restoreFocus() {
        if application.isActive, let previous = previousApplication, previous.processIdentifier != application.processIdentifier {
            _ = previous.activate(options: [.activateIgnoringOtherApps])
        }
    }
    func search(_ query: String, _ split: AXUIElement) throws {
        let field = try one(children(split).filter { role($0) == kAXTextFieldRole && string($0, kAXTitleAttribute) == "搜尋聊天和訊息" })
        guard AXUIElementSetAttributeValue(field, kAXValueAttribute as CFString, query as CFString) == .success else { throw Failure("MAC_UI_CHANGED") }
        Thread.sleep(forTimeInterval: 1.5)
    }
    func chatCells(_ split: AXUIElement, searched: Bool) throws -> [(AXUIElement, String)] {
        let list = try one(children(split).filter { role($0) == kAXListRole })
        var result: [(AXUIElement, String)] = []
        var section = !searched
        var expected: Int? = nil
        var listed = 0
        for row in children(list).prefix(1200) where role(row) == kAXRowRole {
            for cell in children(row) {
                let label = string(cell, kAXTitleAttribute)
                let fields = label.components(separatedBy: ", ")
                if fields.count == 3 && ["顯示全部", "關閉清單", "展開清單", "開啟清單"].contains(fields[2]) && Int(fields[1]) != nil {
                    if let n = expected, listed < n { throw Failure("MAC_SEARCH_INCOMPLETE") }
                    section = ["聊天", "聊天室", "群組", "好友"].contains(fields[0])
                    expected = section ? Int(fields[1]) : nil; listed = 0
                    continue
                }
                if section && !label.isEmpty { result.append((cell, label)); listed += 1 }
            }
        }
        if let n = expected, listed < n { throw Failure("MAC_SEARCH_INCOMPLETE") }
        return result
    }
    func header(_ split: AXUIElement, name: String, type: String) -> Bool {
        let pattern = "^" + NSRegularExpression.escapedPattern(for: name) + (type == "group" ? #", \d+人$"# : "$")
        return children(split).filter { role($0) == kAXButtonRole }.contains { matches(string($0, kAXTitleAttribute), pattern) }
    }
    func select(_ cell: AXUIElement, main: AXUIElement) throws {
        guard application.isActive else { throw Failure("MAC_UI_BUSY") }
        func point(_ element: AXUIElement) throws -> CGPoint {
            guard let v = attribute(element, kAXPositionAttribute), CFGetTypeID(v) == AXValueGetTypeID() else { throw Failure("MAC_UI_CHANGED") }
            var p = CGPoint.zero; AXValueGetValue(unsafeBitCast(v, to: AXValue.self), .cgPoint, &p); return p
        }
        func size(_ element: AXUIElement) throws -> CGSize {
            guard let v = attribute(element, kAXSizeAttribute), CFGetTypeID(v) == AXValueGetTypeID() else { throw Failure("MAC_UI_CHANGED") }
            var s = CGSize.zero; AXValueGetValue(unsafeBitCast(v, to: AXValue.self), .cgSize, &s); return s
        }
        let origin = try point(cell), dimensions = try size(cell)
        let target = CGPoint(x: origin.x + dimensions.width / 2, y: origin.y + min(dimensions.height / 2, 25))
        let bounds = CGRect(origin: try point(main), size: try size(main))
        guard bounds.contains(target) else { throw Failure("MAC_UI_BUSY") }
        for count in 1...2 {
            for type: CGEventType in [.leftMouseDown, .leftMouseUp] {
                guard application.isActive, let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: target, mouseButton: .left) else { throw Failure("MAC_UI_BUSY") }
                event.setIntegerValueField(.mouseEventClickState, value: Int64(count)); event.post(tap: .cghidEventTap)
                Thread.sleep(forTimeInterval: 0.08)
            }
        }
        Thread.sleep(forTimeInterval: 1.5)
    }
    func recent(_ query: String) throws -> [String: Any] {
        defer { restoreFocus() }
        try activate(); let (_, split) = try context(); let identity = try account()
        try search(query, split)
        defer { try? search("", split) }
        let (_, fresh) = try context()
        let cells = try chatCells(fresh, searched: !query.isEmpty)
        let labels = cells.map { $0.1 }
        let names = labels.map(roomName)
        let duplicates = Set(names.filter { name in names.filter { $0 == name }.count > 1 })
        let chats: [[String: String]] = labels.filter { !duplicates.contains(roomName($0)) }.prefix(50).map { ["chatName": roomName($0), "chatType": roomType($0)] }
        guard identity == (try account()) else { throw Failure("CHAT_ACCOUNT_CHANGED") }
        return ["ownSenderRef": identity, "sessionRef": try session(), "chats": chats, "hasMore": cells.count > 50, "duplicateNamesOmitted": !duplicates.isEmpty]
    }
    func read(_ request: [String: Any]) throws -> [String: Any] {
        defer { restoreFocus() }
        guard let name = request["chatName"] as? String, !name.isEmpty, name.count <= 200,
              let type = request["chatType"] as? String, ["direct", "group"].contains(type),
              let expected = request["expectedOwnSenderRef"] as? String,
              let expectedSession = request["expectedSessionRef"] as? String else { throw Failure("INVALID_ARGUMENT") }
        try activate(); let (_, split) = try context()
        guard expected == (try account()), expectedSession == (try session()) else { throw Failure("CHAT_ACCOUNT_CHANGED") }
        try search(name, split)
        defer { try? search("", split) }
        let (main, fresh) = try context()
        let matches = try chatCells(fresh, searched: true).filter { roomName($0.1) == name }
        guard matches.count == 1 else { throw Failure(matches.isEmpty ? "CHAT_NOT_FOUND" : "CHAT_AMBIGUOUS") }
        guard roomType(matches[0].1) == type else { throw Failure("CHAT_IDENTITY_CHANGED") }
        try select(matches[0].0, main: main)
        let (_, selected) = try context()
        guard header(selected, name: name, type: type) else { throw Failure("CHAT_IDENTITY_CHANGED") }
        let panel = try one(children(selected).filter { role($0) == kAXSplitGroupRole })
        let list = try one(children(panel).filter { role($0) == kAXListRole })
        var rows: [String] = []
        for row in children(list).prefix(1200) where role(row) == kAXRowRole {
            for cell in children(row) {
                let value = string(cell, kAXValueAttribute)
                if !value.isEmpty { rows.append(value) }
            }
        }
        let (_, after) = try context()
        guard application.isActive, header(after, name: name, type: type) else { throw Failure("MAC_UI_BUSY") }
        guard expected == (try account()), expectedSession == (try session()) else { throw Failure("CHAT_ACCOUNT_CHANGED") }
        return ["ownSenderRef": expected, "rows": rows, "checkedAt": ISO8601DateFormatter().string(from: Date()), "timeZone": TimeZone.current.identifier]
    }
}

do {
    let data = FileHandle.standardInput.readDataToEndOfFile()
    guard data.count <= 16000, let request = try JSONSerialization.jsonObject(with: data) as? [String: Any], let method = request["method"] as? String else { throw Failure("INVALID_ARGUMENT") }
    var result: [String: Any]
    if method == "status" {
        if let reader = try? Reader() {
            result = ["running": true, "version": reader.version, "verified": reader.version == "26.6.0", "accessibility": AXIsProcessTrusted(), "processState": "running", "mode": "macos-accessibility"]
        } else { result = ["running": false, "verified": false, "version": "", "accessibility": AXIsProcessTrusted(), "processState": "stopped", "mode": "macos-accessibility"] }
    } else {
        let reader = try Reader()
        if method == "session" { _ = try reader.context(); result = ["ownSenderRef": try reader.account(), "sessionRef": try reader.session()] }
        else if method == "recent" { result = try reader.recent(request["query"] as? String ?? "") }
        else if method == "read" { result = try reader.read(request) }
        else { throw Failure("INVALID_ARGUMENT") }
    }
    let output = try JSONSerialization.data(withJSONObject: ["ok": true, "data": result], options: [.sortedKeys, .withoutEscapingSlashes])
    FileHandle.standardOutput.write(output)
} catch {
    let code = (error as? Failure)?.code ?? "MAC_READER_FAILED"
    let output = try! JSONSerialization.data(withJSONObject: ["ok": false, "code": code])
    FileHandle.standardOutput.write(output); exit(1)
}
