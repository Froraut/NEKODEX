// Fixed, owned stdio port. No shell, network or arbitrary path. The only permission-request
// calls are behind the explicit openPermissionSettings user control, for this helper's own identity.
import AppKit
import ApplicationServices
import CryptoKit
import Foundation
import ScreenCaptureKit

let providerID = "nekodex-macos-desktop-v1"
let maximumRequestBytes = 64 * 1024
let maximumImageBytes = 8 * 1024 * 1024
// TCC judges a process by its "responsible" process, which a spawned child inherits. Started
// by the Bun runtime, this helper would be judged as whichever app or terminal started that
// runtime: a grant either far too broad (every NEKODEX child) or one that moves with the
// launcher. The fixed bundle therefore re-executes itself once with responsibility disclaimed.
// TCC then keys the grant to this bundle's identifier and designated requirement, which every
// signed release keeps, so one grant survives updates and covers nothing but this helper.
// Developer ID builds carry the release identifier; ad-hoc DEV builds carry their own, so a DEV
// grant never creates or overwrites the release identifier's TCC row (equal to the builder's constants).
let helperBundleIdentifiers: Set<String> = ["dev.nekodex.desktop-provider.v1", "dev.nekodex.desktop-provider.development.v1"]
let helperStageKey = "NEKODEX_DESKTOP_HELPER_STAGE"
let disclaimedStage = ProcessInfo.processInfo.environment[helperStageKey] == "disclaimed"
typealias ResponsibleForPid = @convention(c) (pid_t, UnsafeMutablePointer<pid_t>, UnsafeMutablePointer<UInt64>, UnsafeMutablePointer<Int>, UnsafeMutablePointer<CChar>) -> Int32
typealias SpawnAttributesSetDisclaim = @convention(c) (UnsafeMutablePointer<posix_spawnattr_t?>, Int32) -> Int32
// libsystem's responsibility calls have no public header; resolve them without linking so a
// missing symbol leaves inherited attribution, which status reports, instead of failing to load.
func systemSymbol<T>(_ name: String, as type: T.Type) -> T? {
    guard let symbol = dlsym(UnsafeMutableRawPointer(bitPattern: -2), name) else { return nil }
    return unsafeBitCast(symbol, to: type)
}
/// The full responsibility record. TCC judges the responsible *path*, which can name another
/// app while the responsible pid is the process itself (observed for the Bun runtime and the
/// helper under NEKODEX 6.1.33-nekodex.8 on macOS 27), so the pid alone proves nothing.
func responsibleProcess(_ pid: pid_t) -> (pid: pid_t, path: String)? {
    guard let query = systemSymbol("responsibility_get_responsible_for_pid", as: ResponsibleForPid.self) else { return nil }
    var responsible: pid_t = 0; var unique: UInt64 = 0
    var buffer = [CChar](repeating: 0, count: 4 * Int(MAXPATHLEN)); var length = buffer.count
    guard query(pid, &responsible, &unique, &length, &buffer) == 0, responsible > 0, length > 0, length <= buffer.count else { return nil }
    buffer[buffer.count - 1] = 0
    return (responsible, String(cString: buffer))
}
func parentProcess(_ pid: pid_t) -> pid_t? {
    guard pid > 0 else { return nil }
    var info = proc_bsdinfo(); let expected = Int32(MemoryLayout<proc_bsdinfo>.size)
    let count = withUnsafeMutablePointer(to: &info) { proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, UnsafeMutableRawPointer($0), expected) }
    guard count == expected, info.pbi_pid == UInt32(pid) else { return nil }
    return pid_t(info.pbi_ppid)
}
func canonicalPath(_ path: String) -> String? {
    guard let resolved = Darwin.realpath(path, nil) else { return nil }
    defer { free(resolved) }; return String(cString: resolved)
}
func ownExecutable() -> String? {
    var buffer = [CChar](repeating: 0, count: 4 * Int(MAXPATHLEN))
    guard proc_pidpath(getpid(), &buffer, UInt32(buffer.count)) > 0 else { return nil }
    return canonicalPath(String(cString: buffer))
}
/// The fixed bundle only: the running image must be this bundle's own canonical executable.
func ownedHelperBundle() -> Bundle? {
    let bundle = Bundle.main
    guard let identifier = bundle.bundleIdentifier, helperBundleIdentifiers.contains(identifier), bundle.bundleURL.pathExtension == "app",
          let executable = ownExecutable(), let declared = bundle.executablePath, canonicalPath(declared) == executable else { return nil }
    return bundle
}
/// The TCC grant now belongs to this helper, so speaking its stdio protocol must not be enough
/// to use it: any same-user process could spawn the bundle. The first enable of each helper
/// process therefore needs the user's answer to a system alert this process shows; a caller
/// without its own input rights cannot answer it. The default button and any failure refuse.
/// Waiting for the person has no expiry; the owner watch still stops the helper if its caller exits.
/// The answer is kept only in this process, whose stdio belongs to the owner
/// that started it; nothing is persisted, so every new helper process asks again.
func userConfirmedEnable() -> Bool {
    var response: CFOptionFlags = 0
    let shown = CFUserNotificationDisplayAlert(0, CFOptionFlags(kCFUserNotificationCautionAlertLevel), nil, nil, nil,
        "Allow NEKODEX desktop control?" as CFString,
        ("NEKODEX Desktop Helper will capture the window you attach and send the clicks and text you approve to it, until NEKODEX releases "
         + "desktop access or restarts. Allow only if you just chose Enable desktop provider in NEKODEX.") as CFString,
        "Don't Allow" as CFString, "Allow" as CFString, nil, &response)
    return shown == 0 && response & 0x3 == CFOptionFlags(kCFUserNotificationAlternateResponse)
}
func selfResponsible() -> Bool {
    guard let record = responsibleProcess(getpid()), record.pid == getpid(), let own = ownExecutable() else { return false }
    return canonicalPath(record.path) == own
}
func permissionClient() -> [String: Any] {
    let bundle = ownedHelperBundle()
    return ["selfResponsible": selfResponsible(), "bundleIdentifier": bundle?.bundleIdentifier ?? NSNull(),
            "name": (bundle?.object(forInfoDictionaryKey: "CFBundleName") as? String) ?? NSNull(), "bundlePath": bundle?.bundlePath ?? NSNull()]
}
func withCStrings<R>(_ values: [String], _ body: ([UnsafeMutablePointer<CChar>?]) -> R) -> R {
    let pointers = values.map { strdup($0) } + [nil]
    defer { for pointer in pointers { free(pointer) } }
    return body(pointers)
}
/// Returns in the helper that serves requests. When this process is not its own responsible
/// process, it spawns the same executable disclaimed and only supervises it; that never returns.
/// A failed disclaim falls back to serving inline, with inherited attribution reported by status.
func becomeOwnPermissionClient() {
    guard !disclaimedStage, !selfResponsible(), ownedHelperBundle() != nil, let executable = ownExecutable(),
          let disclaim = systemSymbol("responsibility_spawnattrs_setdisclaim", as: SpawnAttributesSetDisclaim.self) else { return }
    var attributes: posix_spawnattr_t?; var actions: posix_spawn_file_actions_t?
    guard posix_spawnattr_init(&attributes) == 0 else { return }
    defer { posix_spawnattr_destroy(&attributes) }
    guard posix_spawn_file_actions_init(&actions) == 0 else { return }
    defer { posix_spawn_file_actions_destroy(&actions) }
    var defaults = sigset_t(); sigemptyset(&defaults)
    for signal in [SIGPIPE, SIGTERM, SIGINT, SIGHUP] { sigaddset(&defaults, signal) }
    var mask = sigset_t(); sigemptyset(&mask)
    // Close-on-exec by default: the disclaimed helper inherits exactly the owner's three stdio ports.
    guard posix_spawnattr_setflags(&attributes, Int16(POSIX_SPAWN_CLOEXEC_DEFAULT | POSIX_SPAWN_SETSIGDEF | POSIX_SPAWN_SETSIGMASK)) == 0,
          posix_spawnattr_setsigdefault(&attributes, &defaults) == 0, posix_spawnattr_setsigmask(&attributes, &mask) == 0,
          [STDIN_FILENO, STDOUT_FILENO, STDERR_FILENO].allSatisfy({ posix_spawn_file_actions_addinherit_np(&actions, $0) == 0 }),
          disclaim(&attributes, 1) == 0 else { return }
    var child: pid_t = 0
    // The fixed environment the Bun owner already uses, plus the stage marker that forbids a second hop.
    let spawned = withCStrings([executable]) { argv in
        withCStrings(["PATH=/usr/bin:/bin", "LANG=C", "LC_ALL=C", "\(helperStageKey)=disclaimed"]) { environment in
            posix_spawn(&child, executable, &actions, &attributes, argv, environment)
        }
    }
    guard spawned == 0, child > 0 else { return }
    superviseDisclaimedHelper(child)
}
/// Keeps no copy of the owner's ports, so EOF and closure reach the helper directly. Owner
/// termination signals are forwarded; an owner that disappears takes the helper with it.
func superviseDisclaimedHelper(_ child: pid_t) -> Never {
    let owner = getppid()
    let null = open("/dev/null", O_RDWR)
    if null >= 0 { for descriptor in [STDIN_FILENO, STDOUT_FILENO, STDERR_FILENO] { dup2(null, descriptor) }; if null > STDERR_FILENO { close(null) } }
    let queue = DispatchQueue(label: "dev.nekodex.desktop-provider.supervisor")
    let sources: [DispatchSourceProtocol] = [SIGTERM, SIGINT, SIGHUP].map { value in
        signal(value, SIG_IGN)
        let source = DispatchSource.makeSignalSource(signal: value, queue: queue)
        source.setEventHandler { kill(child, SIGTERM) }; source.resume(); return source
    } + [{
        let watch = DispatchSource.makeTimerSource(queue: queue)
        watch.schedule(deadline: .now() + 1, repeating: 1)
        watch.setEventHandler { if getppid() != owner { kill(child, SIGKILL) } }
        watch.resume(); return watch
    }()]
    var status: Int32 = 0
    while waitpid(child, &status, 0) < 0 { if errno != EINTR { kill(child, SIGKILL); Darwin._exit(1) } }
    withExtendedLifetime(sources) {}
    let signalled = status & 0x7f
    Darwin._exit(signalled == 0 ? (status >> 8) & 0xff : 128 + signalled)
}
let initialParent = getppid()
// The disclaimed helper's parent is its supervisor; input also requires that supervisor's own
// original owner. An unreadable owner fails closed.
let initialOwner: pid_t? = disclaimedStage ? (parentProcess(initialParent) ?? -1) : nil
func ownerIntact() -> Bool { getppid() == initialParent && (initialOwner.map { $0 > 1 && parentProcess(initialParent) == $0 } ?? true) }
func digest(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
func token(_ value: Any) -> String { digest((try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])) ?? Data()) }
func exact(_ value: [String: Any], _ keys: [String]) -> Bool { Set(value.keys) == Set(keys) }
func number(_ value: Any?) -> Double? {
    guard let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(), n.doubleValue.isFinite else { return nil }
    return n.doubleValue
}
func foregroundMode(_ value: [String: Any]) throws -> Bool {
    guard let raw = value["waitForForeground"] else { return false }
    guard let flag = raw as? NSNumber, CFGetTypeID(flag) == CFBooleanGetTypeID(), flag.boolValue else { try reject("invalid-foreground-mode") }
    return true
}
func string(_ value: Any?, max: Int = 160) -> String? {
    guard let value = value as? String, !value.isEmpty, value.utf8.count <= max else { return nil }; return value
}
// LaunchServices launchDate is nil for valid GUI applications started by direct executable.
// Bind PID reuse to the kernel's exact start timeval instead; never fall back to PID alone.
func processInstance(_ pid: pid_t) -> String? {
    guard pid > 0 else { return nil }
    var info = proc_bsdinfo()
    let expected = Int32(MemoryLayout<proc_bsdinfo>.size)
    let count = withUnsafeMutablePointer(to: &info) { pointer in
        proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, UnsafeMutableRawPointer(pointer), expected)
    }
    guard count == expected, info.pbi_pid == UInt32(pid), info.pbi_start_tvsec > 0, info.pbi_start_tvusec < 1_000_000 else { return nil }
    let seconds = info.pbi_start_tvsec.multipliedReportingOverflow(by: 1_000_000)
    let microseconds = seconds.partialValue.addingReportingOverflow(info.pbi_start_tvusec)
    guard !seconds.overflow, !microseconds.overflow else { return nil }
    return "\(pid):\(microseconds.partialValue)"
}
struct PortError: Error { let code: String }
func reject(_ code: String) throws -> Never { throw PortError(code: code) }
struct WindowRow {
    let id: CGWindowID; let pid: pid_t; let processID: String; let epoch: String
    let frame: CGRect; let owner: String; let title: String
    var json: [String: Any] { ["windowId": String(id), "processId": processID, "windowEpoch": epoch,
        "owner": owner, "title": title, "frame": ["x": frame.minX, "y": frame.minY, "width": frame.width, "height": frame.height],
        "foreground": NSWorkspace.shared.frontmostApplication?.processIdentifier == pid] }
}
// CG also lists title-bar accessories as layer-0 surfaces owned by the application.
// macOS 27's 66x20 Window Sharing surface has no AX window and can precede its own
// focused window. Separate application windows still fence foreground authority;
// point hit-testing and the unfiltered CG stack remain mandatory before input.
@MainActor func selectedWindowIsForemost(_ selected: WindowRow, among rows: [WindowRow], isAXWindow: (WindowRow) -> Bool) -> Bool {
    for row in rows {
        if row.id == selected.id { return row.processID == selected.processID }
        if row.pid != selected.pid || isAXWindow(row) { return false }
    }
    return false
}
struct Captured {
    let binding: [String: Any]; let png: Data; let resource: String; let frame: CGRect
    let lastInput: TimeInterval; let focusedElement: AXUIElement?
    let targets: [AXTarget]
    // Set only by an observe that itself waited for the exact foreground window. Active and
    // inactive window chrome differ, so a background screenshot can never match a fresh
    // post-handoff capture.
    var foregroundObserved = false
}
struct AXTarget {
    let element: AXUIElement; let frame: CGRect; let signature: String; let press: Bool
    let selectedTextWritable: Bool; let valueWritable: Bool; let value: String?; let range: CFRange?; let depth: Int
    var text: Bool { range != nil && value != nil && (selectedTextWritable || valueWritable) }
}
func attribute(_ element: AXUIElement, _ name: CFString) -> CFTypeRef? {
    var value: CFTypeRef?; return AXUIElementCopyAttributeValue(element, name, &value) == .success ? value : nil
}
func axFrame(_ element: AXUIElement) -> CGRect? {
    guard let p = attribute(element, kAXPositionAttribute as CFString), let s = attribute(element, kAXSizeAttribute as CFString),
          CFGetTypeID(p) == AXValueGetTypeID(), CFGetTypeID(s) == AXValueGetTypeID() else { return nil }
    var point = CGPoint.zero; var size = CGSize.zero
    guard AXValueGetValue(p as! AXValue, .cgPoint, &point), AXValueGetValue(s as! AXValue, .cgSize, &size) else { return nil }
    return CGRect(origin: point, size: size)
}
func sameFrame(_ a: CGRect, _ b: CGRect) -> Bool {
    abs(a.minX - b.minX) < 0.5 && abs(a.minY - b.minY) < 0.5 && abs(a.width - b.width) < 0.5 && abs(a.height - b.height) < 0.5
}
func lastInputTime() -> TimeInterval {
    let types: [CGEventType] = [.leftMouseDown, .leftMouseUp, .rightMouseDown, .rightMouseUp, .otherMouseDown,
        .otherMouseUp, .mouseMoved, .leftMouseDragged, .rightMouseDragged, .keyDown, .keyUp, .flagsChanged, .scrollWheel]
    let now = ProcessInfo.processInfo.systemUptime
    return types.reduce(0) { value, type in
        let elapsed = CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: type)
        return elapsed.isFinite && elapsed >= 0 ? max(value, now - elapsed) : value
    }
}

@MainActor final class DesktopPort {
    var enabled = false
    /// Set once the user allowed this helper process; never persisted.
    var enableConfirmed = false
    var selected: WindowRow?
    var selectedAX: AXUIElement?
    var captured: Captured?
    var image: Captured?
    var uncertain = false
    var pixelClicks = 0
    let session = UUID().uuidString.lowercased()
    var propertyElements: [(AXUIElement, String)] = []

    func permissions() -> [String: Any] {
        ["screenCaptureGranted": CGPreflightScreenCaptureAccess(), "accessibilityGranted": AXIsProcessTrusted(),
         "postEventGranted": CGPreflightPostEventAccess()]
    }
    func windows() -> [WindowRow] {
        guard let rows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return [] }
        return rows.compactMap { row in
            guard let wid = number(row[kCGWindowNumber as String]), let rawPID = number(row[kCGWindowOwnerPID as String]),
                  wid >= 1, wid <= Double(UInt32.max), rawPID > 0, rawPID <= Double(Int32.max), Int32(rawPID) != getpid(),
                  number(row[kCGWindowLayer as String]) == 0, (number(row[kCGWindowAlpha as String]) ?? 1) > 0,
                  let bounds = row[kCGWindowBounds as String] as? NSDictionary,
                  let frame = CGRect(dictionaryRepresentation: bounds), frame.width >= 1, frame.height >= 1,
                  let processID = processInstance(pid_t(rawPID)) else { return nil }
            let pid = pid_t(rawPID)
            let owner = String((row[kCGWindowOwnerName as String] as? String ?? "Application").prefix(160))
            let title = String((row[kCGWindowName as String] as? String ?? "").prefix(512))
            return WindowRow(id: CGWindowID(wid), pid: pid, processID: processID,
                epoch: token([String(Int(wid)), processID, owner, title]), frame: frame, owner: owner, title: title)
        }.prefix(128).map { $0 }
    }
    func currentWindow() throws -> WindowRow {
        guard let selected = selected, let current = windows().first(where: { $0.id == selected.id }),
              current.processID == selected.processID, current.epoch == selected.epoch else { try reject("selected-window-changed") }
        if let element = selectedAX, !axWindows(current).contains(where: { CFEqual($0, element) }) { try reject("selected-window-instance-changed") }
        return current
    }
    func axWindows(_ row: WindowRow) -> [AXUIElement] {
        (attribute(AXUIElementCreateApplication(row.pid), kAXWindowsAttribute as CFString) as? [AXUIElement]) ?? []
    }
    func matchAX(_ row: WindowRow) -> AXUIElement? {
        guard AXIsProcessTrusted() else { return nil }
        let candidates = axWindows(row).filter { element in
            guard let frame = axFrame(element), sameFrame(frame, row.frame) else { return false }
            return row.title.isEmpty || (attribute(element, kAXTitleAttribute as CFString) as? String) == row.title
        }
        return candidates.count == 1 ? candidates[0] : nil
    }
    func focusElement(_ row: WindowRow) -> AXUIElement? {
        guard let element = attribute(AXUIElementCreateApplication(row.pid), kAXFocusedUIElementAttribute as CFString),
              CFGetTypeID(element) == AXUIElementGetTypeID() else { return nil }
        return (element as! AXUIElement)
    }
    func foregroundWindowOrder(_ row: WindowRow) -> Bool {
        selectedWindowIsForemost(row, among: windows()) { matchAX($0) != nil }
    }
    // The selected window must own the point both by real Accessibility hit-testing and
    // by the CG stacking order. Never send a pixel click through a menu, sheet, popover,
    // another application's window or a nonstandard surface, even one owned by this PID.
    //
    // AX is the authority for system overlays: on macOS 27 the Dock keeps a full-screen
    // layer-20 window and screencaptureui adds a layer-24 one while its toolbar is open.
    // Neither intercepts input, and CG publishes no public "ignores mouse events" key, so
    // a CG-only first-hit test refuses every pixel click. CG still refuses any normal
    // layer-0 window, and any window of the selected process at any layer, stacked above
    // the selected window at the point. This stays immediately before dispatch.
    func pixelTarget(_ row: WindowRow, point: CGPoint) throws {
        guard AXIsProcessTrusted(), let window = selectedAX else { try reject("pixel-target-hit-test-unavailable") }
        // On the system-wide element this timeout is process-global; bound only the hit test
        // and restore the default (0) so later AXPress/value calls keep their normal timeout.
        let system = AXUIElementCreateSystemWide()
        _ = AXUIElementSetMessagingTimeout(system, 1.0)
        defer { _ = AXUIElementSetMessagingTimeout(system, 0) }
        var hit: AXUIElement?
        guard AXUIElementCopyElementAtPosition(system, Float(point.x), Float(point.y), &hit) == .success, let hit = hit,
              hitWindow(hit, pid: row.pid).map({ CFEqual($0, window) }) == true else { try reject("pixel-target-hit-test-mismatch") }
        guard let rows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]],
              stackedAbove(rows, row: row, point: point) == false else { try reject("pixel-target-occluded-or-changed") }
        guard !CGEventSource.buttonState(.combinedSessionState, button: .left),
              !CGEventSource.buttonState(.combinedSessionState, button: .right),
              !CGEventSource.buttonState(.combinedSessionState, button: .center) else { try reject("human-mouse-button-held") }
    }
    // The AX window that owns a hit element, or nil when the hit is not inside a plain
    // window of the selected process (menus, menu bar, sheets, popovers, other apps).
    func hitWindow(_ hit: AXUIElement, pid: pid_t) -> AXUIElement? {
        var hitPID: pid_t = 0
        guard AXUIElementGetPid(hit, &hitPID) == .success, hitPID == pid else { return nil }
        let refused: Set<String> = [kAXSheetRole as String, kAXMenuRole as String, kAXMenuBarRole as String, kAXMenuBarItemRole as String,
            kAXMenuItemRole as String, kAXDrawerRole as String, kAXApplicationRole as String, "AXPopover"]
        let declared = attribute(hit, kAXWindowAttribute as CFString)
        var element = hit
        for _ in 0..<64 {
            var elementPID: pid_t = 0
            guard AXUIElementGetPid(element, &elementPID) == .success, elementPID == pid,
                  let role = attribute(element, kAXRoleAttribute as CFString) as? String, !refused.contains(role) else { return nil }
            if role == (kAXWindowRole as String) {
                if let declared = declared { guard CFGetTypeID(declared) == AXUIElementGetTypeID(), CFEqual(declared, element) else { return nil } }
                return element
            }
            guard let parent = attribute(element, kAXParentAttribute as CFString), CFGetTypeID(parent) == AXUIElementGetTypeID() else { return nil }
            element = parent as! AXUIElement
        }
        return nil
    }
    // CG rows are front-to-back. Returns nil when the selected window does not contain the
    // point, true when a refused surface is above it there, false when it is unobstructed.
    func stackedAbove(_ rows: [[String: Any]], row: WindowRow, point: CGPoint) -> Bool? {
        for value in rows {
            guard (number(value[kCGWindowAlpha as String]) ?? 1) > 0,
                  let bounds = value[kCGWindowBounds as String] as? NSDictionary,
                  let frame = CGRect(dictionaryRepresentation: bounds), frame.contains(point) else { continue }
            let owner = number(value[kCGWindowOwnerPID as String])
            if number(value[kCGWindowNumber as String]) == Double(row.id) { return owner == Double(row.pid) ? false : nil }
            if (number(value[kCGWindowLayer as String]) ?? 0) == 0 || owner == Double(row.pid) { return true }
        }
        return nil
    }
    // An exact approved call may explicitly wait for a human to return this window.
    // This loop never captures, activates, accepts a caller clock or expires consent.
    func waitForForeground(_ original: WindowRow, expectedFocus: AXUIElement? = nil, enforceFocus: Bool = false) async throws {
        while true {
            try Task.checkCancellation()
            guard ownerIntact(), enabled, !uncertain else { try reject("foreground-owner-unavailable") }
            var input = pollfd(fd: STDIN_FILENO, events: Int16(POLLIN), revents: 0)
            guard Darwin.poll(&input, 1, 0) >= 0,
                  input.revents & Int16(POLLHUP | POLLERR | POLLNVAL) == 0 else { try reject("foreground-parent-port-closed") }
            let row = try currentWindow()
            guard sameFrame(row.frame, original.frame) else { try reject("foreground-window-frame-changed") }
            let target = try boundWindow(row)
            let focused = attribute(AXUIElementCreateApplication(row.pid), kAXFocusedWindowAttribute as CFString)
            let currentFocus = focusElement(row)
            let matchingFocus = !enforceFocus || (expectedFocus == nil ? currentFocus == nil : currentFocus.map { CFEqual($0, expectedFocus!) } == true)
            let released = !CGEventSource.buttonState(.combinedSessionState, button: .left)
                && !CGEventSource.buttonState(.combinedSessionState, button: .right)
                && !CGEventSource.buttonState(.combinedSessionState, button: .center)
                && CGEventSource.flagsState(.combinedSessionState).intersection([.maskCommand, .maskControl, .maskAlternate, .maskShift]).isEmpty
            if NSWorkspace.shared.frontmostApplication?.processIdentifier == row.pid,
               let focused = focused, CFEqual(focused, target), foregroundWindowOrder(row),
               matchingFocus, released, ProcessInfo.processInfo.systemUptime - lastInputTime() >= 0.15 { return }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
    }
    func inputOwner(_ row: WindowRow, expectedFocus: AXUIElement?, requirePostEvent: Bool = true) throws {
        guard AXIsProcessTrusted() else { try reject("selected-window-accessibility-unavailable") }
        guard !requirePostEvent || CGPreflightPostEventAccess() else { try reject("selected-window-post-event-unavailable") }
        guard NSWorkspace.shared.frontmostApplication?.processIdentifier == row.pid else { try reject("selected-process-not-frontmost") }
        guard let target = selectedAX, axWindows(row).contains(where: { CFEqual($0, target) }) else { try reject("selected-ax-window-changed") }
        guard let frame = axFrame(target), sameFrame(frame, row.frame) else { try reject("selected-window-frame-changed") }
        guard let focused = attribute(AXUIElementCreateApplication(row.pid), kAXFocusedWindowAttribute as CFString), CFEqual(focused, target) else { try reject("selected-window-not-exactly-focused") }
        guard foregroundWindowOrder(row) else { try reject("selected-window-not-foremost") }
        let currentFocus = focusElement(row)
        if let expected = expectedFocus {
            guard let current = currentFocus, CFEqual(current, expected) else { try reject("focused-element-changed") }
        } else if currentFocus != nil { try reject("focused-element-changed") }
        let flags = CGEventSource.flagsState(.combinedSessionState)
        guard flags.intersection([.maskCommand, .maskControl, .maskAlternate, .maskShift]).isEmpty else { try reject("human-modifier-held") }
    }
    // A pixel click is posted only to the selected process and addressed to the selected window,
    // so it cannot reach another application. AppKit routes a mouse event by the window number
    // and window-relative point in its event record. A CGEvent built from a global point and
    // posted with postToPid has neither: the application sees a window-less event and drops it.
    // Setting kCGMouseEventWindowUnderMousePointer(ThatCanHandleThisEvent) does not route it
    // (live P13, macOS 27.2). NSEvent's public mouse-event constructor fills both. For a window
    // of another process it treats the base-coordinate location as a screen point, so the
    // record's location and its window-relative point both become that point, flipped against
    // a screen height. Read that height from the conversion of the origin, encode the exact
    // top-left window-relative point the same way, and refuse rather than dispatch when the
    // converted record differs from that expectation.
    func pixelClickEvents(window: CGWindowID, local: CGPoint) -> [CGEvent]? {
        guard local.x.isFinite, local.y.isFinite, local.x >= 0, local.y >= 0 else { return nil }
        pixelClicks += 1
        let time = ProcessInfo.processInfo.systemUptime
        func convert(_ kind: NSEvent.EventType, _ base: NSPoint, _ clicks: Int, _ pressure: Float) -> CGEvent? {
            NSEvent.mouseEvent(with: kind, location: base, modifierFlags: [], timestamp: time, windowNumber: Int(window),
                context: nil, eventNumber: pixelClicks, clickCount: clicks, pressure: pressure)?.cgEvent
        }
        guard let origin = convert(.mouseMoved, .zero, 0, 0), abs(origin.location.x) < 0.001,
              origin.location.y.isFinite, origin.location.y > 0 else { return nil }
        let base = NSPoint(x: local.x, y: origin.location.y - local.y)
        let modifiers: CGEventFlags = [.maskAlphaShift, .maskShift, .maskControl, .maskAlternate, .maskCommand, .maskHelp, .maskSecondaryFn, .maskNumericPad]
        var events: [CGEvent] = []
        for (kind, type, clicks, pressure) in [(NSEvent.EventType.mouseMoved, CGEventType.mouseMoved, 0, Float(0)),
                                               (.leftMouseDown, .leftMouseDown, 1, 1), (.leftMouseUp, .leftMouseUp, 1, 0)] {
            guard let cg = convert(kind, base, clicks, pressure),
                  cg.type == type, abs(cg.location.x - local.x) < 0.001, abs(cg.location.y - local.y) < 0.001,
                  cg.flags.intersection(modifiers).isEmpty, cg.getIntegerValueField(.mouseEventButtonNumber) == 0,
                  cg.getIntegerValueField(.mouseEventClickState) == Int64(clicks),
                  NSEvent(cgEvent: cg)?.windowNumber == Int(window) else { return nil }
            events.append(cg)
        }
        return events
    }
    func boundWindow(_ row: WindowRow) throws -> AXUIElement {
        guard AXIsProcessTrusted(), let target = selectedAX, axWindows(row).contains(where: { CFEqual($0, target) }),
              let frame = axFrame(target), sameFrame(frame, row.frame) else { try reject("selected-ax-window-changed") }
        return target
    }
    func controls(_ row: WindowRow) -> [AXTarget] {
        guard let window = try? boundWindow(row) else { return [] }
        var result: [AXTarget] = []; var seen: [AXUIElement] = []; var pending: [(AXUIElement, Int)] = [(window, 0)]
        while !pending.isEmpty && seen.count < 512 && result.count < 128 {
            let (element, depth) = pending.removeLast()
            if seen.contains(where: { CFEqual($0, element) }) { continue }; seen.append(element)
            if (attribute(element, kAXSubroleAttribute as CFString) as? String) == (kAXSecureTextFieldSubrole as String) { continue }
            if depth < 12, let children = attribute(element, kAXChildrenAttribute as CFString) as? [AXUIElement] {
                pending.append(contentsOf: children.prefix(128).map { ($0, depth + 1) })
            }
            guard let frame = axFrame(element), !frame.intersection(row.frame).isNull, frame.width > 0, frame.height > 0,
                  (attribute(element, kAXEnabledAttribute as CFString) as? Bool) != false,
                  (attribute(element, kAXHiddenAttribute as CFString) as? Bool) != true,
                  let role = attribute(element, kAXRoleAttribute as CFString) as? String else { continue }
            var elementPID: pid_t = 0
            guard AXUIElementGetPid(element, &elementPID) == .success, elementPID == row.pid else { continue }
            if let elementWindow = attribute(element, kAXWindowAttribute as CFString), !CFEqual(elementWindow, window) { continue }
            let subrole = attribute(element, kAXSubroleAttribute as CFString) as? String ?? ""
            if subrole == (kAXSecureTextFieldSubrole as String) { continue }
            var actionNames: CFArray?; _ = AXUIElementCopyActionNames(element, &actionNames)
            let press = ((actionNames as? [String]) ?? []).contains(kAXPressAction as String)
            let isText = role == (kAXTextFieldRole as String) || role == (kAXTextAreaRole as String)
            var selectedWritable: DarwinBoolean = false; var valueWritable: DarwinBoolean = false
            if isText {
                _ = AXUIElementIsAttributeSettable(element, kAXSelectedTextAttribute as CFString, &selectedWritable)
                _ = AXUIElementIsAttributeSettable(element, kAXValueAttribute as CFString, &valueWritable)
            }
            guard press || (isText && (selectedWritable.boolValue || valueWritable.boolValue)) else { continue }
            let rawValue = attribute(element, kAXValueAttribute as CFString)
            let textValue = isText ? rawValue as? String : nil
            if let textValue = textValue, textValue.utf16.count > 64_000 { continue }
            var range: CFRange?
            if isText, let value = attribute(element, kAXSelectedTextRangeAttribute as CFString), CFGetTypeID(value) == AXValueGetTypeID() {
                var r = CFRange(); if AXValueGetValue(value as! AXValue, .cfRange, &r), r.location >= 0, r.length >= 0,
                    r.location <= (textValue?.utf16.count ?? 0), r.length <= (textValue?.utf16.count ?? 0) - r.location { range = r }
            }
            let title = attribute(element, kAXTitleAttribute as CFString) as? String ?? ""
            let valueState: Any = textValue ?? (rawValue as? NSNumber)?.stringValue ?? ""
            let signature = token([role, subrole, title, valueState, press, selectedWritable.boolValue, valueWritable.boolValue,
                frame.minX, frame.minY, frame.width, frame.height, range?.location ?? -1, range?.length ?? -1,
                (attribute(element, kAXFocusedAttribute as CFString) as? Bool) ?? false])
            result.append(AXTarget(element: element, frame: frame, signature: signature, press: press,
                selectedTextWritable: selectedWritable.boolValue, valueWritable: valueWritable.boolValue,
                value: textValue, range: range, depth: depth))
        }
        return result
    }
    // Trusted property readback has its own fresh AX read. It neither captures the
    // screen nor turns an input receipt into an application result.
    func applicationProperties(_ row: WindowRow) throws -> [[String: Any]] {
        let window = try boundWindow(row)
        var result: [[String: Any]] = []; var seen: [AXUIElement] = []; var pending: [(AXUIElement, Int)] = [(window, 0)]
        while !pending.isEmpty && seen.count < 512 && result.count < 128 {
            let (element, depth) = pending.removeLast()
            if seen.contains(where: { CFEqual($0, element) }) { continue }; seen.append(element)
            guard (attribute(element, kAXSubroleAttribute as CFString) as? String) != (kAXSecureTextFieldSubrole as String),
                  (attribute(element, kAXHiddenAttribute as CFString) as? Bool) != true else { continue }
            var pid: pid_t = 0
            guard AXUIElementGetPid(element, &pid) == .success, pid == row.pid else { continue }
            if let elementWindow = attribute(element, kAXWindowAttribute as CFString), !CFEqual(elementWindow, window) { continue }
            if depth < 12, let children = attribute(element, kAXChildrenAttribute as CFString) as? [AXUIElement] {
                pending.append(contentsOf: children.prefix(128).map { ($0, depth + 1) })
            }
            guard let frame = axFrame(element), frame.width > 0, frame.height > 0, !frame.intersection(row.frame).isNull,
                  let role = attribute(element, kAXRoleAttribute as CFString) as? String else { continue }
            let identifier = attribute(element, kAXIdentifierAttribute as CFString) as? String
            let title = attribute(element, kAXTitleAttribute as CFString) as? String
            let rawValue = attribute(element, kAXValueAttribute as CFString)
            var value: Any?
            if let text = rawValue as? String, text.utf16.count <= 4096 { value = text }
            else if let numeric = rawValue as? NSNumber, numeric.doubleValue.isFinite { value = numeric }
            let elementID: String
            if let retained = propertyElements.first(where: { CFEqual($0.0, element) }) { elementID = retained.1 }
            else {
                guard propertyElements.count < 512 else { try reject("property-identity-capacity") }
                elementID = "ax-" + UUID().uuidString.lowercased(); propertyElements.append((element, elementID))
            }
            var item: [String: Any] = ["elementId": elementID, "role": String(role.prefix(160))]
            if let identifier = identifier, !identifier.isEmpty, identifier.utf16.count <= 512 { item["identifier"] = identifier }
            if let title = title, !title.isEmpty, title.utf16.count <= 512 { item["title"] = title }
            if let value = value { item["value"] = value }
            if let enabled = attribute(element, kAXEnabledAttribute as CFString) as? Bool { item["enabled"] = enabled }
            if let focused = attribute(element, kAXFocusedAttribute as CFString) as? Bool { item["focused"] = focused }
            // Window-relative points with a top-left origin: the space a screenshot-pixel click
            // maps into, so a text reviewer can judge containment without the image.
            item["frame"] = ["x": frame.minX - row.frame.minX, "y": frame.minY - row.frame.minY, "width": frame.width, "height": frame.height]
            result.append(item)
        }
        guard let encoded = try? JSONSerialization.data(withJSONObject: result), encoded.count <= 60 * 1024 else { try reject("property-snapshot-size-limit") }
        return result
    }
    func capture(_ row: WindowRow, scope: String) async throws -> Captured {
        guard enabled, CGPreflightScreenCaptureAccess() else { try reject("screen-capture-unavailable") }
        _ = try boundWindow(row)
        let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
        guard let window = content.windows.first(where: { $0.windowID == row.id && $0.owningApplication?.processID == row.pid }),
              window.isOnScreen, sameFrame(window.frame, row.frame) else { try reject("capture-window-changed") }
        let filter = SCContentFilter(desktopIndependentWindow: window)
        guard abs(filter.contentRect.width - row.frame.width) < 0.5, abs(filter.contentRect.height - row.frame.height) < 0.5 else { try reject("window-content-coordinate-mismatch") }
        let scale = Double(filter.pointPixelScale)
        guard scale.isFinite, scale > 0 else { try reject("capture-scale-unavailable") }
        let width = Int(ceil(row.frame.width * scale)); let height = Int(ceil(row.frame.height * scale))
        guard width > 0, height > 0, width <= 8192, height <= 8192, width * height <= 16_777_216 else { try reject("capture-size-limit") }
        let configuration = SCStreamConfiguration(); configuration.width = width; configuration.height = height
        configuration.showsCursor = false; configuration.ignoreShadowsSingleWindow = true
        let beforeTargets = controls(row)
        let cgImage = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
        let current = try currentWindow()
        let targets = controls(current)
        guard targets.count == beforeTargets.count, zip(targets, beforeTargets).allSatisfy({ CFEqual($0.element, $1.element) && $0.signature == $1.signature }) else { try reject("ax-state-changed-during-capture") }
        guard current.processID == row.processID, current.epoch == row.epoch, sameFrame(current.frame, row.frame),
              cgImage.width == width, cgImage.height == height,
              let png = NSBitmapImageRep(cgImage: cgImage).representation(using: .png, properties: [:]), png.count <= maximumImageBytes else { try reject("capture-changed-or-too-large") }
        let observationID = UUID().uuidString.lowercased(); let resource = "native-desktop:\(session):\(observationID)"
        let frameEpoch = token([row.frame.minX, row.frame.minY, row.frame.width, row.frame.height, scale])
        let binding: [String: Any] = ["providerId": providerID, "scopeId": scope, "observationId": observationID, "platform": "darwin",
            "windowId": String(row.id), "processId": row.processID, "windowEpoch": row.epoch,
            "frameId": "window-\(row.id)", "frameEpoch": frameEpoch, "screenshotId": digest(png),
            "coordinateSpace": "screenshot-pixels", "width": width, "height": height]
        return Captured(binding: binding, png: png, resource: resource, frame: row.frame, lastInput: lastInputTime(), focusedElement: AXIsProcessTrusted() ? focusElement(row) : nil, targets: targets)
    }
    func perform(_ request: [String: Any]) async throws -> [String: Any] {
        guard number(request["version"]) == 1, let command = string(request["command"], max: 32) else { try reject("invalid-request") }
        let base = ["version", "id", "command"]
        switch command {
        case "status":
            guard exact(request, base) else { try reject("invalid-request") }
            var state = permissions(); state["enabled"] = enabled; state["providerId"] = providerID; state["uncertain"] = uncertain
            state["permissionClient"] = permissionClient()
            let current = try? currentWindow()
            state["selected"] = selected?.json ?? NSNull(); state["selectionCurrent"] = current != nil
            state["inputWindowBound"] = current.flatMap { try? boundWindow($0) } != nil; return state
        case "listWindows":
            guard exact(request, base) else { try reject("invalid-request") }
            // Titles need the helper's own screen recording grant; before the user confirms
            // enablement, only the owner names and identities needed to choose a window are listed.
            return ["windows": windows().map { enabled ? $0.json : $0.json.merging(["title": ""]) { $1 } }]
        case "openPermissionSettings":
            // Explicit user control only. Registration targets this helper's own identity, never a
            // responsible parent app or terminal, and grants nothing: the user still decides in the pane.
            guard exact(request, base + ["permission"]), let permission = string(request["permission"], max: 32),
                  let pane = ["screenCapture": "Privacy_ScreenCapture", "accessibility": "Privacy_Accessibility", "postEvent": "Privacy_Accessibility"][permission],
                  let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?\(pane)") else { try reject("invalid-request") }
            let registered = selfResponsible() && ownedHelperBundle() != nil
            if registered {
                switch permission {
                case "screenCapture": _ = CGRequestScreenCaptureAccess()
                case "accessibility": _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
                default: _ = CGRequestPostEventAccess()
                }
            }
            guard NSWorkspace.shared.open(url) else { try reject("settings-unavailable") }
            var state = permissions(); state["permissionClient"] = permissionClient(); state["pane"] = pane; state["registered"] = registered
            return state
        case "enable":
            guard exact(request, base + ["enabled"]), let value = request["enabled"] as? NSNumber, CFGetTypeID(value) == CFBooleanGetTypeID() else { try reject("invalid-request") }
            enabled = false; selected = nil; selectedAX = nil; captured = nil; image = nil; propertyElements = []
            if value.boolValue, !enableConfirmed {
                guard userConfirmedEnable() else { try reject("enable-not-confirmed") }
                enableConfirmed = true
            }
            enabled = value.boolValue
            return ["enabled": enabled]
        case "select":
            guard exact(request, base + ["selection"]), enabled, !uncertain,
                  let selection = request["selection"] as? [String: Any], exact(selection, ["windowId", "processId", "windowEpoch"]),
                  let row = windows().first(where: { $0.json["windowId"] as? String == selection["windowId"] as? String
                    && $0.processID == selection["processId"] as? String && $0.epoch == selection["windowEpoch"] as? String }) else { try reject("selection-unavailable-or-changed") }
            selected = row; selectedAX = matchAX(row); captured = nil; image = nil; propertyElements = []
            return ["selected": row.json, "inputWindowBound": selectedAX != nil]
        case "properties":
            guard exact(request, base + ["selection"]), enabled, !uncertain, AXIsProcessTrusted(),
                  let selection = request["selection"] as? [String: Any], exact(selection, ["windowId", "processId", "windowEpoch"]) else { try reject("property-read-unavailable") }
            let row = try currentWindow()
            guard selection["windowId"] as? String == String(row.id), selection["processId"] as? String == row.processID,
                  selection["windowEpoch"] as? String == row.epoch else { try reject("property-selection-changed") }
            let properties = try applicationProperties(row)
            let current = try currentWindow(); _ = try boundWindow(current)
            guard sameFrame(current.frame, row.frame), token(properties) == token(try applicationProperties(current)) else { try reject("property-state-changed-during-read") }
            return ["selection": selection, "observedAt": ISO8601DateFormatter().string(from: Date()), "properties": properties,
                    "window": ["width": row.frame.width, "height": row.frame.height]]
        case "observe":
            let waits = try foregroundMode(request)
            guard exact(request, base + ["scopeId"] + (waits ? ["waitForForeground"] : [])), !uncertain,
                  let scope = string(request["scopeId"]) else { try reject("observation-unavailable") }
            captured = nil; image = nil
            let row = try currentWindow()
            if waits { try await waitForForeground(row) }
            let foregroundBaseline = lastInputTime()
            var value = try await capture(try currentWindow(), scope: scope)
            value.foregroundObserved = waits
            if waits {
                try inputOwner(try currentWindow(), expectedFocus: value.focusedElement, requirePostEvent: false)
                guard value.lastInput <= foregroundBaseline + 0.005, lastInputTime() <= foregroundBaseline + 0.005 else { try reject("human-input-changed") }
            }
            captured = value; image = value
            // The observed window size in points maps screenshot pixels to window-relative points.
            // It is metadata beside the binding, never part of the input binding identity.
            return value.binding.merging(["kind": "desktop", "screenshotResource": value.resource,
                "windowSize": ["width": value.frame.width, "height": value.frame.height]]) { _, new in new }
        case "image":
            guard exact(request, base + ["binding", "resource", "encoding"]), let value = image,
                  let binding = request["binding"] as? [String: Any], NSDictionary(dictionary: binding).isEqual(to: value.binding),
                  request["resource"] as? String == value.resource else { try reject("image-resource-unavailable") }
            if request["encoding"] as? String == "png" { return ["mimeType": "image/png", "base64": value.png.base64EncodedString(), "sha256": digest(value.png)] }
            guard request["encoding"] as? String == "jpeg", let bitmap = NSBitmapImageRep(data: value.png) else { try reject("image-encoding-unsupported") }
            for quality in [0.8, 0.55, 0.3, 0.1, 0.01] {
                if let jpeg = bitmap.representation(using: .jpeg, properties: [.compressionFactor: quality]), jpeg.count <= 160 * 1024 {
                    return ["mimeType": "image/jpeg", "base64": jpeg.base64EncodedString(), "sha256": digest(jpeg),
                        "sourceScreenshotId": digest(value.png), "width": bitmap.pixelsWide, "height": bitmap.pixelsHigh]
                }
            }
            try reject("model-image-budget-exceeded")
        case "act":
            guard exact(request, base + ["binding", "action", "operationId"]), let operationID = string(request["operationId"]),
                  let binding = request["binding"] as? [String: Any], let action = request["action"] as? [String: Any] else { try reject("invalid-request") }
            func receipt(_ outcome: String, _ executed: Bool, _ reason: String) -> [String: Any] {
                ["operationId": operationID, "outcome": outcome, "executed": executed, "reason": reason]
            }
            guard ownerIntact(), enabled, !uncertain, let original = captured, NSDictionary(dictionary: binding).isEqual(to: original.binding) else { return receipt("rejected", false, "stale-observation") }
            captured = nil // One attempt owns this observation even if later validation refuses input.
            let row = try currentWindow()
            let waits = try foregroundMode(action)
            if waits && !original.foregroundObserved { return receipt("rejected", false, "observe-with-foreground-required") }
            if waits && !sameFrame(row.frame, original.frame) { return receipt("rejected", false, "owner-or-frame-changed") }
            if waits { try await waitForForeground(row, expectedFocus: original.focusedElement, enforceFocus: true) }
            let foregroundBaseline = lastInputTime()
            let fresh = try await capture(try currentWindow(), scope: binding["scopeId"] as! String)
            guard fresh.binding["screenshotId"] as? String == binding["screenshotId"] as? String,
                  fresh.binding["frameEpoch"] as? String == binding["frameEpoch"] as? String else { return receipt("rejected", false, "screen-or-frame-changed") }
            let current = try currentWindow()
            guard sameFrame(current.frame, original.frame) else { return receipt("rejected", false, "owner-or-frame-changed") }
            // Only exact same-image/frame/focus handoff can establish a new private input
            // boundary. Original binding is unchanged and never replaced with fresh.binding.
            let inputBaseline: TimeInterval
            if waits {
                try inputOwner(current, expectedFocus: original.focusedElement, requirePostEvent: false)
                guard fresh.lastInput <= foregroundBaseline + 0.005, lastInputTime() <= foregroundBaseline + 0.005 else { return receipt("rejected", false, "human-input-changed") }
                inputBaseline = fresh.lastInput
            } else { inputBaseline = original.lastInput }
            if action["kind"] as? String == "click" {
                guard exact(action, ["kind", "x", "y"] + (waits ? ["waitForForeground"] : [])), let x = number(action["x"]), let y = number(action["y"]),
                      x.rounded() == x, y.rounded() == y, x >= 0, y >= 0,
                      x < Double(binding["width"] as! Int), y < Double(binding["height"] as! Int) else { return receipt("rejected", false, "coordinates-outside-observation") }
                // The observed frame defines the screenshot-pixel map: window-relative top-left
                // points, and the global CG point that is hit-tested.
                let local = CGPoint(x: x * original.frame.width / Double(binding["width"] as! Int),
                    y: y * original.frame.height / Double(binding["height"] as! Int))
                let point = CGPoint(x: original.frame.minX + local.x, y: original.frame.minY + local.y)
                let candidates = original.targets.filter { $0.press && $0.frame.intersection(row.frame).contains(point) }
                    .sorted { $0.depth != $1.depth ? $0.depth > $1.depth : $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }
                if let target = candidates.first {
                    guard candidates.count < 2 || candidates[1].depth != target.depth,
                          let nowTarget = fresh.targets.first(where: { CFEqual($0.element, target.element) }), nowTarget.signature == target.signature else { return receipt("rejected", false, "ambiguous-or-changed-ax-target") }
                    _ = try boundWindow(current)
                    guard let last = controls(current).first(where: { CFEqual($0.element, target.element) }), last.signature == target.signature else { return receipt("rejected", false, "ax-target-changed-before-input") }
                    guard ownerIntact() else { return receipt("rejected", false, "parent-owner-exited") }
                    if waits {
                        try inputOwner(try currentWindow(), expectedFocus: original.focusedElement, requirePostEvent: false)
                        try pixelTarget(current, point: point)
                        guard lastInputTime() <= inputBaseline + 0.005 else { return receipt("rejected", false, "human-input-changed") }
                    }
                    let status = AXUIElementPerformAction(target.element, kAXPressAction as CFString)
                    if status == .success { return receipt("completed", true, "ax-press-dispatched; application-result-unverified") }
                    uncertain = status == .cannotComplete; return receipt(uncertain ? "unknown" : "rejected", false, "ax-press-not-confirmed")
                }
                // Generic event input is available only when the selected exact window is already foreground.
                try inputOwner(current, expectedFocus: original.focusedElement)
                guard fresh.lastInput <= inputBaseline + 0.005, lastInputTime() <= inputBaseline + 0.005 else { return receipt("rejected", false, "human-input-changed") }
                guard let events = pixelClickEvents(window: row.id, local: local) else { return receipt("rejected", false, "event-unavailable") }
                guard ownerIntact() else { return receipt("rejected", false, "parent-owner-exited") }
                // Recheck owner, frame, focus, point stacking and physical button/modifier state
                // as close to dispatch as possible; no activation or click-through. The events
                // carry the window-relative point, so the window must still have the observed
                // frame that maps it to the hit-tested global point.
                let latest = try currentWindow()
                guard sameFrame(latest.frame, original.frame) else { return receipt("rejected", false, "owner-or-frame-changed") }
                try inputOwner(latest, expectedFocus: original.focusedElement)
                try pixelTarget(latest, point: point)
                guard lastInputTime() <= inputBaseline + 0.005 else { return receipt("rejected", false, "human-input-changed") }
                for event in events { event.postToPid(row.pid) }
            } else if action["kind"] as? String == "type" {
                guard exact(action, ["kind", "text"] + (waits ? ["waitForForeground"] : [])), let text = action["text"] as? String, !text.isEmpty, text.utf16.count <= 8000 else { return receipt("rejected", false, "invalid-literal-text") }
                if let focused = original.focusedElement, let target = original.targets.first(where: { CFEqual($0.element, focused) && $0.text }) {
                    guard let currentTarget = fresh.targets.first(where: { CFEqual($0.element, target.element) }), currentTarget.signature == target.signature,
                          let currentFocus = focusElement(current), CFEqual(currentFocus, target.element),
                          let oldValue = target.value, let range = target.range else { return receipt("rejected", false, "captured-text-target-changed") }
                    let window = try boundWindow(current)
                    guard let focusedWindow = attribute(AXUIElementCreateApplication(row.pid), kAXFocusedWindowAttribute as CFString), CFEqual(window, focusedWindow),
                          let last = controls(current).first(where: { CFEqual($0.element, target.element) }), last.signature == target.signature else { return receipt("rejected", false, "text-target-changed-before-input") }
                    let status: AXError
                    guard ownerIntact() else { return receipt("rejected", false, "parent-owner-exited") }
                    if waits {
                        try inputOwner(try currentWindow(), expectedFocus: original.focusedElement, requirePostEvent: false)
                        let hitFrame = target.frame.intersection(current.frame)
                        guard !hitFrame.isEmpty else { return receipt("rejected", false, "captured-text-target-changed") }
                        try pixelTarget(current, point: CGPoint(x: hitFrame.midX, y: hitFrame.midY))
                        guard lastInputTime() <= inputBaseline + 0.005 else { return receipt("rejected", false, "human-input-changed") }
                    }
                    if target.selectedTextWritable { status = AXUIElementSetAttributeValue(target.element, kAXSelectedTextAttribute as CFString, text as CFString) }
                    else {
                        let replacement = (oldValue as NSString).replacingCharacters(in: NSRange(location: range.location, length: range.length), with: text)
                        status = AXUIElementSetAttributeValue(target.element, kAXValueAttribute as CFString, replacement as CFString)
                    }
                    if status == .success { return receipt("completed", true, "ax-literal-text-dispatched; application-result-unverified") }
                    uncertain = status == .cannotComplete; return receipt(uncertain ? "unknown" : "rejected", false, "ax-text-not-confirmed")
                }
                return receipt("rejected", false, "captured-supported-text-target-unavailable")
            } else { return receipt("rejected", false, "unsupported-action") }
            return receipt("completed", true, "input-dispatched; application-result-unverified")
        case "invalidate":
            guard exact(request, base) else { try reject("invalid-request") }
            captured = nil; image = nil; return ["invalidated": true]
        case "shutdown":
            guard exact(request, base) else { try reject("invalid-request") }
            captured = nil; image = nil; selected = nil; selectedAX = nil; propertyElements = []; return ["closing": true]
        default: try reject("unsupported-command")
        }
    }
}

final class Lines: @unchecked Sendable {
    var pending = Data()
    func next() throws -> Data? {
        while true {
            if let newline = pending.firstIndex(of: 10) {
                guard newline <= maximumRequestBytes else { try reject("request-size-limit") }
                let line = pending.prefix(upTo: newline); pending.removeSubrange(...newline); return Data(line)
            }
            guard pending.count <= maximumRequestBytes else { try reject("request-size-limit") }
            var bytes = [UInt8](repeating: 0, count: 4096)
            let count = Darwin.read(STDIN_FILENO, &bytes, bytes.count)
            if count == 0 { return nil }
            if count < 0 { if errno == EINTR { continue }; try reject("stdin-unavailable") }
            pending.append(contentsOf: bytes.prefix(count))
        }
    }
}
// The helper build never defines this; a test compiles this file with an inert encoding
// harness as its entry point instead.
#if !NEKODEX_DESKTOP_HELPER_HARNESS
@main struct Main {
    @MainActor static func main() async {
        becomeOwnPermissionClient()
        _ = (initialParent, initialOwner) // Globals are lazy: pin the owner chain at start, not at first use.
        let port = DesktopPort(); let lines = Lines()
        let ownerWatch = DispatchSource.makeTimerSource(queue: .global(qos: .background))
        ownerWatch.schedule(deadline: .now() + 1, repeating: 1)
        ownerWatch.setEventHandler { if !ownerIntact() { Darwin._exit(0) } }
        ownerWatch.resume()
        while true {
            var requestID = "invalid"
            do {
                guard let bytes = try await Task.detached(operation: { try lines.next() }).value else { break }
                guard let request = try JSONSerialization.jsonObject(with: bytes) as? [String: Any], let id = string(request["id"]) else { try reject("invalid-request") }
                requestID = id
                let value = try await port.perform(request)
                let reply: [String: Any] = ["version": 1, "id": id, "ok": true, "value": value]
                FileHandle.standardOutput.write((try JSONSerialization.data(withJSONObject: reply, options: [.sortedKeys])) + Data([10]))
                if request["command"] as? String == "shutdown" { break }
            } catch {
                let code = (error as? PortError)?.code ?? "native-operation-unavailable"
                let reply: [String: Any] = ["version": 1, "id": requestID, "ok": false, "error": code]
                if let bytes = try? JSONSerialization.data(withJSONObject: reply) { FileHandle.standardOutput.write(bytes + Data([10])) }
                if code == "request-size-limit" { break }
            }
        }
        ownerWatch.cancel()
    }
}
#endif
