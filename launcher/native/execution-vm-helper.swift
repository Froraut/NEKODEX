import Foundation
import Virtualization
import CryptoKit
import Darwin
import CoreFoundation

// BuildIdentity is generated from captured immutable source/entitlement bytes by
// the direct builder. No user-selected code/configuration participates in build.
private let wire = "neko-vm-v1"
private let maxFrame = 262144
private let maxFrames = 16384
private let reasons: Set<String> = ["cancelled", "timeout", "parent-eof", "protocol-error", "output-limit", "guest-result", "transport-error"]
private enum Failure: Error { case refused }
private func fail() throws -> Never { throw Failure.refused }
private func hash(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
private func hex(_ text: String, bytes: Int) -> Data? {
    guard text.utf8.count == bytes * 2, text.range(of: "^[a-f0-9]+$", options: .regularExpression) != nil else { return nil }
    var data = Data(); var offset = text.startIndex
    for _ in 0..<bytes { let end = text.index(offset, offsetBy: 2); guard let byte = UInt8(text[offset..<end], radix: 16) else { return nil }; data.append(byte); offset = end }
    return data
}
private func exact(_ value: [String: Any], _ keys: Set<String>) throws { guard Set(value.keys) == keys else { try fail() } }
private func string(_ value: [String: Any], _ key: String, maximum: Int = 4096) throws -> String {
    guard let text = value[key] as? String, text.utf8.count <= maximum else { try fail() }; return text
}
private func integer(_ value: [String: Any], _ key: String, minimum: Int = 0, maximum: Int) throws -> Int {
    guard let n = value[key] as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(), n.doubleValue.isFinite,
          n.doubleValue.rounded() == n.doubleValue, n.doubleValue >= Double(minimum), n.doubleValue <= Double(maximum) else { try fail() }
    return n.intValue
}
private func boolean(_ value: [String: Any], _ key: String) throws -> Bool {
    guard let n = value[key] as? NSNumber, CFGetTypeID(n) == CFBooleanGetTypeID() else { try fail() }; return n.boolValue
}
private func relative(_ text: String) throws -> String {
    guard !text.isEmpty, text.utf8.count <= 512, text.range(of: "^[A-Za-z0-9_.+@/-]+$", options: .regularExpression) != nil, !text.hasPrefix("/"), !text.contains("\\"),
          !text.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
          text.split(separator: "/", omittingEmptySubsequences: false).allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }) else { try fail() }
    return text
}
private func collides(_ path: String, _ paths: Set<String>) -> Bool {
    let candidate = path.lowercased(); return paths.contains { let old = $0.lowercased(); return old == candidate || old.hasPrefix(candidate + "/") || candidate.hasPrefix(old + "/") }
}
// Foundation's JSON decoder accepts duplicate object keys. Reject those before
// decoding, including nested payloads and escaped equivalents of the same key.
private struct UniqueJSON {
    let bytes: [UInt8]; var index = 0
    mutating func whitespace() { while index < bytes.count && [9, 10, 13, 32].contains(bytes[index]) { index += 1 } }
    mutating func text() throws -> String {
        let begin = index; guard index < bytes.count && bytes[index] == 34 else { try fail() }; index += 1
        while index < bytes.count { let c = bytes[index]; index += 1
            if c == 34 { let token = Data(bytes[begin..<index]); guard let s = try JSONSerialization.jsonObject(with: token, options: .fragmentsAllowed) as? String else { try fail() }; return s }
            if c == 92 { guard index < bytes.count else { try fail() }; index += 1 }
        }; try fail()
    }
    mutating func value(_ depth: Int = 0) throws {
        guard depth < 12 else { try fail() }; whitespace(); guard index < bytes.count else { try fail() }
        if bytes[index] == 34 { _ = try text(); return }
        if bytes[index] == 123 {
            index += 1; whitespace(); var keys = Set<String>(); if index < bytes.count && bytes[index] == 125 { index += 1; return }
            while true { whitespace(); let key = try text(); guard keys.insert(key).inserted else { try fail() }; whitespace()
                guard index < bytes.count && bytes[index] == 58 else { try fail() }; index += 1; try value(depth + 1); whitespace()
                guard index < bytes.count else { try fail() }; let c = bytes[index]; index += 1; if c == 125 { return }; guard c == 44 else { try fail() }
            }
        }
        if bytes[index] == 91 {
            index += 1; whitespace(); if index < bytes.count && bytes[index] == 93 { index += 1; return }
            while true { try value(depth + 1); whitespace(); guard index < bytes.count else { try fail() }; let c = bytes[index]; index += 1; if c == 93 { return }; guard c == 44 else { try fail() } }
        }
        let begin = index; while index < bytes.count && ![9, 10, 13, 32, 44, 93, 125].contains(bytes[index]) { index += 1 }; guard index > begin else { try fail() }
    }
}
private func object(_ data: Data, maximum: Int = maxFrame) throws -> [String: Any] {
    guard !data.isEmpty, data.count <= maximum, String(data: data, encoding: .utf8) != nil else { try fail() }
    var scan = UniqueJSON(bytes: Array(data)); try scan.value(); scan.whitespace(); guard scan.index == data.count,
          let result = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { try fail() }; return result
}
private func privateStat(_ path: String, directory: Bool) throws -> stat {
    var s = stat(); guard path.hasPrefix("/"), path.utf8.count <= 4096, !path.contains("\0"), lstat(path, &s) == 0,
          URL(fileURLWithPath: path).resolvingSymlinksInPath().path == path, s.st_uid == getuid(), s.st_mode & 0o077 == 0,
          s.st_mode & S_IFMT == (directory ? S_IFDIR : S_IFREG), directory || s.st_nlink == 1 else { try fail() }; return s
}
private func pinnedFile(_ path: String, maximum: Int, privateOnly: Bool = false, consume: ((Data) -> Void)? = nil) throws -> Data {
    var before = stat(); guard lstat(path, &before) == 0, before.st_mode & S_IFMT == S_IFREG,
          URL(fileURLWithPath: path).resolvingSymlinksInPath().path == path, before.st_size >= 0, before.st_size <= maximum,
          privateOnly ? before.st_uid == getuid() && before.st_mode & 0o077 == 0 && before.st_nlink == 1
            : (before.st_uid == getuid() || before.st_uid == 0) && before.st_mode & 0o022 == 0 else { try fail() }
    let fd = open(path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC); guard fd >= 0 else { try fail() }; defer { close(fd) }
    var opened = stat(); guard fstat(fd, &opened) == 0, opened.st_dev == before.st_dev, opened.st_ino == before.st_ino else { try fail() }
    var result = Data(), total = 0, buffer = [UInt8](repeating: 0, count: 65536)
    while true { let n = Darwin.read(fd, &buffer, buffer.count); if n == 0 { break }; if n < 0 { if errno == EINTR { continue }; try fail() }; total += n; guard total <= maximum else { try fail() }; let chunk = Data(buffer[0..<n]); if let consume = consume { consume(chunk) } else { result.append(chunk) } }
    var after = stat(); guard lstat(path, &after) == 0, after.st_dev == before.st_dev, after.st_ino == before.st_ino,
          after.st_size == before.st_size, after.st_mtimespec.tv_sec == before.st_mtimespec.tv_sec, after.st_mtimespec.tv_nsec == before.st_mtimespec.tv_nsec,
          after.st_ctimespec.tv_sec == before.st_ctimespec.tv_sec, after.st_ctimespec.tv_nsec == before.st_ctimespec.tv_nsec else { try fail() }
    return result
}
private func pinnedDigest(_ path: String) throws -> String {
    var hasher = SHA256(); _ = try pinnedFile(path, maximum: 536870912, consume: { hasher.update(data: $0) })
    return hasher.finalize().map { String(format: "%02x", $0) }.joined()
}
private struct Configuration {
    let actionId: String, nonce: String, sha256: String, kernel: String, initrd: String, kernelSHA: String, initrdSHA: String, jobRoot: String
    let key: Data, bootTimeout: Int; let rootDevice: dev_t, rootInode: ino_t
    init(path: String, expected: String) throws {
        guard hex(expected, bytes: 32) != nil else { try fail() }; let raw = try pinnedFile(path, maximum: 16384, privateOnly: true)
        guard hash(raw) == expected else { try fail() }; let o = try object(raw, maximum: 16384)
        try exact(o, ["protocol", "actionId", "nonce", "kernelPath", "kernelSha256", "initrdPath", "initrdSha256", "jobRoot", "cpuCount", "memoryBytes", "bootTimeoutMs", "maxFrameBytes", "logLimitBytes", "receiptKeyHex"])
        guard try string(o, "protocol") == wire else { try fail() }; let id = try string(o, "actionId", maximum: 36)
        guard UUID(uuidString: id) != nil, id.count == 36 else { try fail() }; actionId = id
        nonce = try string(o, "nonce"); guard hex(nonce, bytes: 32) != nil else { try fail() }; sha256 = expected
        guard try integer(o, "cpuCount", maximum: 2) == 2, try integer(o, "memoryBytes", maximum: 2147483648) == 2147483648,
              try integer(o, "maxFrameBytes", maximum: maxFrame) == maxFrame, try integer(o, "logLimitBytes", maximum: 1048576) == 1048576 else { try fail() }
        bootTimeout = try integer(o, "bootTimeoutMs", minimum: 1, maximum: 120000)
        guard let receiptKey = hex(try string(o, "receiptKeyHex"), bytes: 32) else { try fail() }; key = receiptKey
        jobRoot = try string(o, "jobRoot"); let root = try privateStat(jobRoot, directory: true); rootDevice = root.st_dev; rootInode = root.st_ino
        guard URL(fileURLWithPath: path).deletingLastPathComponent().path == jobRoot else { try fail() }
        kernel = try string(o, "kernelPath"); initrd = try string(o, "initrdPath")
        kernelSHA = try string(o, "kernelSha256"); initrdSHA = try string(o, "initrdSha256")
        guard try pinnedDigest(kernel) == kernelSHA, try pinnedDigest(initrd) == initrdSHA else { try fail() }
    }
}
private final class Transfer {
    let path: String, size: Int, sha: String; var offset = 0, hasher = SHA256()
    init(_ o: [String: Any]) throws {
        path = try relative(string(o, "path")); size = try integer(o, "size", maximum: 67108864); sha = try string(o, "sha256")
        let mode = try integer(o, "mode", maximum: 448); guard [384, 448].contains(mode), hex(sha, bytes: 32) != nil else { try fail() }
    }
    func chunk(_ o: [String: Any]) throws {
        guard try string(o, "path") == path, try integer(o, "offset", maximum: size) == offset else { try fail() }
        let encoded = try string(o, "dataBase64", maximum: 87384); guard let data = Data(base64Encoded: encoded), data.base64EncodedString() == encoded, !data.isEmpty, data.count <= 65536, offset + data.count <= size else { try fail() }
        hasher.update(data: data); offset += data.count
    }
    func end(_ o: [String: Any]) throws { guard try string(o, "path") == path, offset == size, hasher.finalize().map({ String(format: "%02x", $0) }).joined() == sha else { try fail() } }
}
// One main-queue bounded nonblocking output pump; a stuck parent/guest cannot
// block the VZ stop callback. Suspended sources are resumed before cancellation.
private final class Pump {
    let fd: Int32; var buffer = Data(); var source: DispatchSourceWrite?; var resumed = false; var closed = false
    var drained: (() -> Void)?; var failed: (() -> Void)?
    init(_ fd: Int32) { self.fd = fd; _ = fcntl(fd, F_SETFL, fcntl(fd, F_GETFL) | O_NONBLOCK)
        let s = DispatchSource.makeWriteSource(fileDescriptor: fd, queue: .main); source = s; s.setEventHandler { [weak self] in self?.flush() }
    }
    func append(_ data: Data) -> Bool { guard !closed, buffer.count + data.count <= 2097152 else { return false }; buffer.append(data); flush(); return !closed }
    func flush() {
        guard !closed else { return }
        while !buffer.isEmpty {
            let n = buffer.withUnsafeBytes { Darwin.write(fd, $0.baseAddress, $0.count) }
            if n > 0 { buffer.removeFirst(n); continue }; if n < 0 && errno == EINTR { continue }
            if n < 0 && [EAGAIN, EWOULDBLOCK].contains(errno) { if !resumed { source?.resume(); resumed = true }; return }
            closed = true; failed?(); return
        }
        if resumed { source?.suspend(); resumed = false }; drained?()
    }
    func cancel() { if !resumed { source?.resume(); resumed = true }; source?.cancel(); source = nil; closed = true; buffer.removeAll() }
}
private final class Runner: NSObject, VZVirtualMachineDelegate {
    let config: Configuration; let stdout = Pump(STDOUT_FILENO)
    var stdinSource: DispatchSourceRead?, guestSource: DispatchSourceRead?, consoleSource: DispatchSourceRead?
    var stdinSuspended = false, guestSuspended = false, consoleSuspended = false
    var parentBuffer = Data(), guestBuffer = Data(); var parentFrames = 0, guestFrames = 0
    var machine: VZVirtualMachine?, connection: VZVirtioSocketConnection?, guestPump: Pump?
    var consoleWriter: FileHandle?, consoleFD: Int32 = -1
    var startAttempted = false, startPending = false, connectionPending = false, connectedOnce = false, hello = false, ready = false, executed = false, result = false
    var stopping = false, finalized = false, stopCallPending = false, closingChannels = false, closingCount = 0
    var reason = "transport-error", stopEvidence: String?, bootTimer: DispatchSourceTimer?, connectTimer: DispatchSourceTimer?, jobTimer: DispatchSourceTimer?
    var input: Transfer?, output: Transfer?, inputPaths = Set<String>(), outputPaths = Set<String>(), allowedOutputs = Set<String>()
    var inputBytes = 0, outputBytes = 0, logBytes = 0, consoleBytes = 0
    init(_ config: Configuration) { self.config = config; super.init() }
    func event(_ name: String, _ fields: [String: Any] = [:]) {
        var o: [String: Any] = ["protocol": wire, "actionId": config.actionId, "nonce": config.nonce, "configSha256": config.sha256, "event": name]
        for (k, v) in fields { o[k] = v }
        guard let bytes = try? JSONSerialization.data(withJSONObject: o, options: .sortedKeys), bytes.count <= maxFrame else { stop("protocol-error"); return }
        if !stdout.append(bytes + Data([10])) && !stopping { stop("output-limit") }
    }
    func scope(_ o: [String: Any], helper: Bool) throws {
        guard try string(o, "protocol") == wire, try string(o, "actionId") == config.actionId, try string(o, "nonce") == config.nonce else { try fail() }
        if helper { guard try string(o, "configSha256") == config.sha256 else { try fail() } }
    }
    func begin() {
        signal(SIGPIPE, SIG_IGN)
        stdout.failed = { [weak self] in self?.stop("parent-eof") }
        stdout.drained = { [weak self] in DispatchQueue.main.async { self?.resumeGuest() } }
        _ = fcntl(STDIN_FILENO, F_SETFL, fcntl(STDIN_FILENO, F_GETFL) | O_NONBLOCK)
        let s = DispatchSource.makeReadSource(fileDescriptor: STDIN_FILENO, queue: .main); stdinSource = s
        s.setEventHandler { [weak self] in self?.readParent() }; s.resume()
        event("helper-ready", ["pid": Int(getpid())])
    }
    func readParent() {
        guard !finalized && !closingChannels else { return }; var bytes = [UInt8](repeating: 0, count: 65536)
        let n = Darwin.read(STDIN_FILENO, &bytes, bytes.count)
        if n == 0 { stop("parent-eof"); return }; if n < 0 { if ![EAGAIN, EWOULDBLOCK, EINTR].contains(errno) { stop("transport-error") }; return }
        parentBuffer.append(contentsOf: bytes[0..<n]); consumeParent()
    }
    func consumeParent() {
        while !closingChannels, let at = parentBuffer.firstIndex(of: 10) {
            let line = parentBuffer.prefix(upTo: at); parentBuffer.removeSubrange(...at); parentFrames += 1
            do { guard parentFrames <= maxFrames else { try fail() }; let o = try object(Data(line)); try parent(o) }
            catch { parentBuffer.removeAll(); if !stdinSuspended { stdinSource?.suspend(); stdinSuspended = true }; event("error", ["code": "parent-protocol"]); stop("protocol-error"); return }
            if (guestPump?.buffer.count ?? 0) > 524288 { if !stdinSuspended { stdinSource?.suspend(); stdinSuspended = true }; break }
        }
        if parentBuffer.count > maxFrame { parentBuffer.removeAll(); if !stdinSuspended { stdinSource?.suspend(); stdinSuspended = true }; stop("protocol-error") }
    }
    func parent(_ o: [String: Any]) throws {
        try scope(o, helper: true); let command = try string(o, "command")
        let common: Set<String> = ["protocol", "actionId", "nonce", "configSha256", "command"]
        if command == "start" { try exact(o, common); guard !startAttempted, !stopping else { try fail() }; startAttempted = true; try startVM(); return }
        if command == "stop" { try exact(o, common.union(["reason"])); let r = try string(o, "reason"); guard reasons.contains(r) else { try fail() }; stop(r); return }
        guard command == "guest-frame", !stopping, connection != nil else { try fail() }; try exact(o, common.union(["payload"]))
        guard let payload = o["payload"] as? [String: Any] else { try fail() }; try scope(payload, helper: false); try hostFrame(payload)
        let data = try JSONSerialization.data(withJSONObject: payload, options: .sortedKeys); guard data.count <= maxFrame, guestPump?.append(data + Data([10])) == true else { try fail() }
    }
    func hostFrame(_ p: [String: Any]) throws {
        let type = try string(p, "type"), common: Set<String> = ["protocol", "actionId", "nonce", "type"]
        switch type {
        case "hello": try exact(p, common); guard !hello else { try fail() }; hello = true
        case "file-begin":
            try exact(p, common.union(["path", "mode", "size", "sha256"])); guard ready, !executed, input == nil, inputPaths.count < 4096 else { try fail() }
            let t = try Transfer(p); guard !collides(t.path, inputPaths), inputBytes + t.size <= 67108864 else { try fail() }; inputBytes += t.size; input = t
        case "file-chunk": try exact(p, common.union(["path", "offset", "dataBase64"])); guard let t = input, !executed else { try fail() }; try t.chunk(p)
        case "file-end": try exact(p, common.union(["path"])); guard let t = input, !executed else { try fail() }; try t.end(p); inputPaths.insert(t.path); input = nil
        case "execute":
            try exact(p, common.union(["script", "outputPaths", "timeoutMs"])); guard ready, !executed, input == nil, let paths = p["outputPaths"] as? [String], paths.count <= 256 else { try fail() }
            let script = try string(p, "script", maximum: 65536); guard !script.contains("\0") else { try fail() }; for path in paths { let value = try relative(path); guard !collides(value, allowedOutputs), allowedOutputs.insert(value).inserted else { try fail() } }
            let timeout = try integer(p, "timeoutMs", minimum: 1, maximum: 600000); executed = true
            // Independent helper deadline covers boot/hello/ALL input import.
            // Backpressure may delay parent stop/EOF; ready is not permission to
            // remove that deadline before execute takes over with its own timer.
            bootTimer?.cancel(); bootTimer = nil
            jobTimer = timer(timeout) { [weak self] in self?.stop("timeout") }
        default: try fail()
        }
    }
    func timer(_ milliseconds: Int, _ handler: @escaping () -> Void) -> DispatchSourceTimer {
        let t = DispatchSource.makeTimerSource(queue: .main); t.schedule(deadline: .now() + .milliseconds(milliseconds)); t.setEventHandler(handler: handler); t.resume(); return t
    }
    func startVM() throws {
        #if !arch(arm64)
        try fail()
        #endif
        guard try pinnedDigest(config.kernel) == config.kernelSHA, try pinnedDigest(config.initrd) == config.initrdSHA else { try fail() }
        let boot = VZLinuxBootLoader(kernelURL: URL(fileURLWithPath: config.kernel)); boot.initialRamdiskURL = URL(fileURLWithPath: config.initrd)
        boot.commandLine = "console=hvc0 rdinit=/init panic=-1"
        let c = VZVirtualMachineConfiguration(); c.bootLoader = boot; c.cpuCount = 2; c.memorySize = 2147483648
        c.networkDevices = []; c.directorySharingDevices = []; c.storageDevices = []; c.socketDevices = [VZVirtioSocketDeviceConfiguration()]
        var fds: [Int32] = [-1, -1]; guard pipe(&fds) == 0 else { try fail() }; consoleFD = fds[0]
        _ = fcntl(fds[0], F_SETFL, O_NONBLOCK); _ = fcntl(fds[0], F_SETFD, FD_CLOEXEC); _ = fcntl(fds[1], F_SETFD, FD_CLOEXEC)
        let writer = FileHandle(fileDescriptor: fds[1], closeOnDealloc: true); consoleWriter = writer
        let serial = VZVirtioConsoleDeviceSerialPortConfiguration(); serial.attachment = VZFileHandleSerialPortAttachment(fileHandleForReading: nil, fileHandleForWriting: writer); c.serialPorts = [serial]
        try c.validate(); guard c.cpuCount == 2, c.memorySize == 2147483648, c.networkDevices.isEmpty, c.directorySharingDevices.isEmpty, c.storageDevices.isEmpty, c.socketDevices.count == 1 else { try fail() }
        let vm = VZVirtualMachine(configuration: c, queue: .main); machine = vm; vm.delegate = self
        let source = DispatchSource.makeReadSource(fileDescriptor: fds[0], queue: .main); consoleSource = source
        source.setEventHandler { [weak self] in self?.readConsole() }; source.resume()
        bootTimer = timer(config.bootTimeout) { [weak self] in self?.stop("timeout") }
        startPending = true; event("vm-starting")
        // A broken parent output channel can request cancellation synchronously
        // while emitting vm-starting. Never boot after that request.
        if stopping { startPending = false; requestVMStop(); return }
        vm.start { [weak self] outcome in guard let self = self else { return }; self.startPending = false
            switch outcome {
            case .success: self.event("vm-running"); if self.stopping { self.requestVMStop() } else { self.connectGuest() }
            case .failure: self.event("error", ["code": "vm-start"]); self.stop("transport-error"); self.requestVMStop()
            }
        }
    }
    func connectGuest() {
        guard !stopping, !connectedOnce, !connectionPending, let socket = machine?.socketDevices.first as? VZVirtioSocketDevice else { return }
        connectionPending = true
        socket.connect(toPort: 4041) { [weak self] outcome in guard let self = self else { return }; self.connectionPending = false
            switch outcome {
            case .success(let connection):
                if self.stopping { connection.close(); self.finishIfClosed(); return }
                self.connectedOnce = true; self.connection = connection; self.connectTimer?.cancel(); self.connectTimer = nil
                let fd = connection.fileDescriptor; let pump = Pump(fd); self.guestPump = pump
                pump.failed = { [weak self] in self?.stop("transport-error") }
                pump.drained = { [weak self] in DispatchQueue.main.async { guard let self = self, !self.stopping else { return }; if self.stdinSuspended { self.stdinSource?.resume(); self.stdinSuspended = false }; self.consumeParent() } }
                let s = DispatchSource.makeReadSource(fileDescriptor: fd, queue: .main); self.guestSource = s
                s.setEventHandler { [weak self] in self?.readGuest() }; s.resume(); self.event("guest-connected")
            case .failure:
                if self.stopping { self.finishIfClosed() } else { self.connectTimer = self.timer(250) { [weak self] in self?.connectGuest() } }
            }
        }
    }
    func readConsole() {
        guard !closingChannels else { return }; var bytes = [UInt8](repeating: 0, count: 32768); let n = Darwin.read(consoleFD, &bytes, bytes.count)
        if n > 0 { consoleBytes += n; if consoleBytes > 1048576 { if !consoleSuspended { consoleSource?.suspend(); consoleSuspended = true }; stop("output-limit"); return }; event("console", ["dataBase64": Data(bytes[0..<n]).base64EncodedString()]) }
        else if n < 0 && ![EAGAIN, EWOULDBLOCK, EINTR].contains(errno) { stop("transport-error") }
    }
    func readGuest() {
        guard !stopping, let connection = connection else { return }; var bytes = [UInt8](repeating: 0, count: 65536); let n = Darwin.read(connection.fileDescriptor, &bytes, bytes.count)
        if n == 0 { stop("transport-error"); return }; if n < 0 { if ![EAGAIN, EWOULDBLOCK, EINTR].contains(errno) { stop("transport-error") }; return }
        guestBuffer.append(contentsOf: bytes[0..<n]); consumeGuest()
    }
    func consumeGuest() {
        while !stopping, let at = guestBuffer.firstIndex(of: 10) {
            let line = guestBuffer.prefix(upTo: at); guestBuffer.removeSubrange(...at); guestFrames += 1
            do { guard guestFrames <= maxFrames else { try fail() }; let payload = try object(Data(line)); try scope(payload, helper: false); try guestFrame(payload); event("guest-frame", ["payload": payload])
                if result { stop("guest-result"); return }
            } catch { event("error", ["code": "guest-protocol"]); stop("protocol-error"); return }
            if stdout.buffer.count > 524288 { if !guestSuspended { guestSource?.suspend(); guestSuspended = true }; break }
        }
        if guestBuffer.count > maxFrame { stop("protocol-error") }
    }
    func resumeGuest() { guard !stopping else { return }; if guestSuspended { guestSource?.resume(); guestSuspended = false }; consumeGuest() }
    func guestFrame(_ p: [String: Any]) throws {
        let common: Set<String> = ["protocol", "actionId", "nonce", "type"]; let type = try string(p, "type")
        switch type {
        case "ready":
            try exact(p, common.union(["agentVersion", "architecture", "capability"])); guard hello, !ready, try integer(p, "agentVersion", maximum: 1) == 1, try string(p, "architecture") == "arm64", try string(p, "capability") == "linux-shell" else { try fail() }; ready = true
        case "stdout", "stderr":
            try exact(p, common.union(["dataBase64"])); guard executed, !result else { try fail() }; let encoded = try string(p, "dataBase64", maximum: 87384)
            guard let data = Data(base64Encoded: encoded), !data.isEmpty, data.count <= 65536, data.base64EncodedString() == encoded else { try fail() }; logBytes += data.count; guard logBytes <= 1048576 else { try fail() }
        case "output-begin":
            try exact(p, common.union(["path", "mode", "size", "sha256"])); guard executed, !result, output == nil, outputPaths.count < 256 else { try fail() }; let t = try Transfer(p)
            guard allowedOutputs.contains(t.path), !outputPaths.contains(t.path), outputBytes + t.size <= 16777216 else { try fail() }; outputBytes += t.size; output = t
        case "output-chunk": try exact(p, common.union(["path", "offset", "dataBase64"])); guard let t = output, !result else { try fail() }; try t.chunk(p)
        case "output-end": try exact(p, common.union(["path"])); guard let t = output, !result else { try fail() }; try t.end(p); outputPaths.insert(t.path); output = nil
        case "result":
            try exact(p, common.union(["exitCode", "signal", "outputs", "stdoutTruncated", "stderrTruncated", "errorCode"])); guard executed, !result, output == nil, let paths = p["outputs"] as? [String], paths.count == outputPaths.count, Set(paths) == outputPaths else { try fail() }
            if !(p["exitCode"] is NSNull) { _ = try integer(p, "exitCode", maximum: 255) }; if !(p["signal"] is NSNull) { _ = try integer(p, "signal", minimum: 1, maximum: 127) }
            _ = try boolean(p, "stdoutTruncated"); _ = try boolean(p, "stderrTruncated")
            if !(p["errorCode"] is NSNull) { let code = try string(p, "errorCode", maximum: 64); guard ["protocol-error", "input-error", "execution-error", "output-error", "output-limit", "timeout", "cancelled"].contains(code) else { try fail() } }; result = true
        default: try fail()
        }
    }
    func stop(_ r: String) {
        guard !finalized else { return }; if !stopping { stopping = true; reason = reasons.contains(r) ? r : "protocol-error"; event("stopping", ["reason": reason]); bootTimer?.cancel(); connectTimer?.cancel(); jobTimer?.cancel() }
        if !startAttempted { event("terminal", ["state": "never-started", "reason": reason]); exitAfterFlush(1); return }
        if !guestSuspended, guestSource != nil { guestSource?.suspend(); guestSuspended = true }; requestVMStop()
    }
    func requestVMStop() {
        guard stopping, !finalized, !startPending, !stopCallPending else { return }
        guard let vm = machine else { event("error", ["code": "vm-unavailable"]); exitAfterFlush(1); return }
        stopCallPending = true
        vm.stop { [weak self] error in guard let self = self else { return }; self.stopCallPending = false
            // Error alone is never proof. A self-stop racing the request may
            // yield an invalid-transition error while the exact VZ state is stopped.
            if self.machine?.state == .stopped { self.observedStop("host-stop-completion") }
            else { self.event("error", ["code": "vm-stop-unverified"]) }
        }
    }
    func guestDidStop(_ virtualMachine: VZVirtualMachine) { guard virtualMachine === machine, virtualMachine.state == .stopped else { return }; observedStop("delegate-stopped") }
    func virtualMachine(_ virtualMachine: VZVirtualMachine, didStopWithError error: Error) {
        guard virtualMachine === machine else { return }; if virtualMachine.state == .stopped { observedStop("delegate-stopped") } else { event("error", ["code": "vm-error-unverified"]); stop("transport-error") }
    }
    func observedStop(_ evidence: String) {
        guard !finalized else { return }; stopEvidence = stopEvidence ?? evidence
        if !stopping { stopping = true; reason = result ? "guest-result" : "transport-error"; event("stopping", ["reason": reason]) }
        bootTimer?.cancel(); connectTimer?.cancel(); jobTimer?.cancel(); closeChannels()
    }
    func closeChannels() {
        guard !closingChannels else { finishIfClosed(); return }; closingChannels = true
        parentBuffer.removeAll(); guestBuffer.removeAll(); guestPump?.cancel(); guestPump = nil
        if let s = stdinSource { if stdinSuspended { s.resume(); stdinSuspended = false }; closingCount += 1; s.setCancelHandler { [weak self] in close(STDIN_FILENO); self?.closingCount -= 1; self?.finishIfClosed() }; s.cancel(); stdinSource = nil }
        if let s = guestSource { if guestSuspended { s.resume(); guestSuspended = false }; closingCount += 1; let c = connection
            s.setCancelHandler { [weak self] in c?.close(); self?.connection = nil; self?.closingCount -= 1; self?.finishIfClosed() }; s.cancel(); guestSource = nil
        } else { connection?.close(); connection = nil }
        if let s = consoleSource { if consoleSuspended { s.resume(); consoleSuspended = false }; closingCount += 1; let fd = consoleFD
            s.setCancelHandler { [weak self] in close(fd); self?.consoleFD = -1; self?.closingCount -= 1; self?.finishIfClosed() }; s.cancel(); consoleSource = nil
        } else if consoleFD >= 0 { close(consoleFD); consoleFD = -1 }
        do { try consoleWriter?.close(); consoleWriter = nil } catch { event("error", ["code": "channel-close-unverified"]); return }
        finishIfClosed()
    }
    func finishIfClosed() {
        guard !finalized, closingChannels, closingCount == 0, !connectionPending, !startPending, connection == nil,
              consoleFD == -1, consoleWriter == nil, let evidence = stopEvidence, machine?.state == .stopped else { return }
        finalized = true
        do { try persistStopped(evidence); event("vm-stopped", ["stopEvidence": evidence, "reason": reason]); event("terminal", ["state": "stopped", "reason": reason]); exitAfterFlush(0) }
        catch { event("error", ["code": "receipt-write-failed"]); exitAfterFlush(1) }
    }
    func persistStopped(_ evidence: String) throws {
        let current = try privateStat(config.jobRoot, directory: true); guard current.st_dev == config.rootDevice, current.st_ino == config.rootInode else { try fail() }
        let rootFD = open(config.jobRoot, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC); guard rootFD >= 0 else { try fail() }; defer { close(rootFD) }
        var opened = stat(); guard fstat(rootFD, &opened) == 0, opened.st_dev == config.rootDevice, opened.st_ino == config.rootInode else { try fail() }
        let body: [String: Any] = ["protocol": wire, "actionId": config.actionId, "nonce": config.nonce, "configSha256": config.sha256,
            "helperPid": Int(getpid()), "vmState": "stopped", "channelsClosed": true, "stopEvidence": evidence, "reason": reason,
            "timestampMs": Int64(Date().timeIntervalSince1970 * 1000)]
        let bytes = try JSONSerialization.data(withJSONObject: body, options: .sortedKeys)
        let mac = HMAC<SHA256>.authenticationCode(for: bytes, using: SymmetricKey(data: config.key)).map { String(format: "%02x", $0) }.joined()
        let envelope = try JSONSerialization.data(withJSONObject: ["bodyBase64": bytes.base64EncodedString(), "macHex": mac], options: .sortedKeys)
        let fd = openat(rootFD, "stopped.pending", O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600); guard fd >= 0 else { try fail() }
        var success = false; defer { close(fd); if !success { /* uncertain exact candidate is retained */ } }
        try envelope.withUnsafeBytes { raw in var at = 0; while at < raw.count { let n = Darwin.write(fd, raw.baseAddress!.advanced(by: at), raw.count - at); if n < 0 && errno == EINTR { continue }; guard n > 0 else { try fail() }; at += n } }
        guard fsync(fd) == 0, renameatx_np(rootFD, "stopped.pending", rootFD, "stopped.json", UInt32(RENAME_EXCL)) == 0, fsync(rootFD) == 0 else { try fail() }; success = true
    }
    func exitAfterFlush(_ status: Int32) {
        stdout.flush(); if stdout.buffer.isEmpty || stdout.closed { exit(status) }
        stdout.drained = { exit(status) }; DispatchQueue.main.asyncAfter(deadline: .now() + 2) { exit(status) }
    }
}

if CommandLine.arguments == [CommandLine.arguments[0], "--describe-build"] {
    let value: [String: Any] = ["version": 1, "provider": "macos-virtualization", "protocol": wire, "target": "darwin-arm64", "sourceSha256": BuildIdentity.sourceSha256,
        "entitlementsSha256": BuildIdentity.entitlementsSha256, "cpuCount": 2, "memoryBytes": 2147483648, "guestPort": 4041]
    if let bytes = try? JSONSerialization.data(withJSONObject: value, options: .sortedKeys) { FileHandle.standardOutput.write(bytes + Data([10])); exit(0) }; exit(1)
}
guard CommandLine.arguments.count == 4, CommandLine.arguments[1] == "--run" else { exit(64) }
do {
    let config = try Configuration(path: CommandLine.arguments[2], expected: CommandLine.arguments[3]); let runner = Runner(config)
    runner.begin(); withExtendedLifetime(runner) { dispatchMain() }
} catch { FileHandle.standardError.write(Data("execution-vm-helper: invalid-config\n".utf8)); exit(65) }
