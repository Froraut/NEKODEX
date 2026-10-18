// Native, noninteractive Keychain port shared by Electron, Bun and launchd.
// Build a stable signed helper identity; never log stdin, records or errors from
// Security.framework. JSON travels only over the parent's captured private pipes.
import Foundation
import Security

let protocolVersion = 1
let maximumBytes = 24 * 1024
let maximumSecretBytes = 8192
let service = "dev.nekodex.tunnel-credentials.v1"

func matches(_ value: String, _ pattern: String) -> Bool {
    value.range(of: pattern, options: .regularExpression) != nil
}
func exactKeys(_ value: [String: Any], _ keys: [String]) -> Bool {
    Set(value.keys) == Set(keys)
}
func integer(_ value: Any?, equals expected: Int) -> Bool {
    guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return false }
    return number.doubleValue == Double(expected)
}
func uuid(_ value: Any?) -> Bool {
    guard let text = value as? String else { return false }
    return matches(text, "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[1-5][a-fA-F0-9]{3}-[89abAB][a-fA-F0-9]{3}-[a-fA-F0-9]{12}$")
}
func hash(_ value: Any?) -> Bool {
    guard let text = value as? String else { return false }
    return matches(text, "^[a-f0-9]{64}$")
}
func reference(_ value: Any?) -> [String: Any]? {
    guard let value = value as? [String: Any], exactKeys(value, ["version", "provider", "id", "revision"]),
          integer(value["version"], equals: protocolVersion), value["provider"] as? String == "os-vault",
          uuid(value["id"]), uuid(value["revision"]) else { return nil }
    return value
}
func account(_ ref: [String: Any]) -> String {
    "\((ref["id"] as! String).lowercased()):\((ref["revision"] as! String).lowercased())"
}
func record(_ value: Any?) -> [String: Any]? {
    guard let value = value as? [String: Any], exactKeys(value, ["version", "reference", "scopeHash", "owner", "secret"]),
          integer(value["version"], equals: protocolVersion), reference(value["reference"]) != nil,
          hash(value["scopeHash"]), uuid(value["owner"]), let secret = value["secret"] as? String,
          !secret.isEmpty, secret.utf8.count <= maximumSecretBytes,
          !secret.unicodeScalars.contains(where: { $0.value <= 32 || $0.value == 127 }) else { return nil }
    return value
}
func result(_ status: String, _ detail: [String: Any] = [:]) -> [String: Any] {
    var response = detail
    response["version"] = protocolVersion
    response["status"] = status
    return response
}
func statusName(_ status: OSStatus) -> String {
    switch status {
    case errSecInteractionNotAllowed, errSecAuthFailed, errSecUserCanceled: return "locked"
    case errSecItemNotFound: return "not-found"
    case errSecDuplicateItem: return "conflict"
    case errSecDecode: return "corrupt"
    case errSecUnimplemented: return "unsupported"
    default: return "unavailable"
    }
}
func query(_ ref: [String: Any]) -> [String: Any] {
    [kSecClass as String: kSecClassGenericPassword,
     kSecAttrService as String: service,
     kSecAttrAccount as String: account(ref),
     kSecUseAuthenticationUI as String: kSecUseAuthenticationUIFail]
}
func ownershipData(_ scopeHash: String, _ owner: String) -> Data {
    // Queryable immutable attributes ensure exact deletion even if another
    // same-user writer changes this item between the read and delete calls.
    Data("\(scopeHash):\(owner.lowercased())".utf8)
}
func readRecord(_ ref: [String: Any]) -> (String, [String: Any]?) {
    var lookup = query(ref)
    lookup[kSecReturnData as String] = true
    lookup[kSecMatchLimit as String] = kSecMatchLimitOne
    var output: CFTypeRef?
    let status = SecItemCopyMatching(lookup as CFDictionary, &output)
    guard status == errSecSuccess else { return (statusName(status), nil) }
    guard let data = output as? Data, data.count <= maximumBytes,
          let object = try? JSONSerialization.jsonObject(with: data), let stored = record(object),
          let storedRef = reference(stored["reference"]), account(storedRef) == account(ref) else { return ("corrupt", nil) }
    return ("ok", stored)
}
func availability() -> String {
    var keychain: SecKeychain?
    let copyStatus = SecKeychainCopyDefault(&keychain)
    guard copyStatus == errSecSuccess, let keychain = keychain else { return statusName(copyStatus) }
    var state: SecKeychainStatus = 0
    let status = SecKeychainGetStatus(keychain, &state)
    guard status == errSecSuccess else { return statusName(status) }
    return state & SecKeychainStatus(kSecUnlockStateStatus) != 0 ? "ok" : "locked"
}
func perform(_ request: [String: Any]) -> [String: Any] {
    guard integer(request["version"], equals: protocolVersion), let operation = request["operation"] as? String else { return result("corrupt") }
    // Legacy macOS keychains can otherwise prompt even when a per-query flag is
    // unsupported. Disable interaction for this short-lived helper process too.
    let interaction = SecKeychainSetUserInteractionAllowed(false)
    guard interaction == errSecSuccess else { return result(statusName(interaction)) }
    if operation == "capabilities" {
        guard exactKeys(request, ["version", "operation"]) else { return result("corrupt") }
        return result(availability())
    }
    if operation == "prepare" {
        guard exactKeys(request, ["version", "operation", "record"]), let stored = record(request["record"]),
              let ref = reference(stored["reference"]), let data = try? JSONSerialization.data(withJSONObject: stored, options: [.sortedKeys]),
              data.count <= maximumBytes else { return result("corrupt") }
        let available = availability()
        guard available == "ok" else { return result(available) }
        var insertion = query(ref)
        insertion[kSecValueData as String] = data
        insertion[kSecAttrGeneric as String] = ownershipData(stored["scopeHash"] as! String, stored["owner"] as! String)
        insertion[kSecAttrLabel as String] = "NEKODEX protected tunnel credential"
        // A new immutable account/revision is inserted; updates are unsupported.
        let status = SecItemAdd(insertion as CFDictionary, nil)
        return result(status == errSecSuccess ? "ok" : statusName(status))
    }
    if operation == "resolve" {
        guard exactKeys(request, ["version", "operation", "reference", "scopeHash"]), let ref = reference(request["reference"]),
              hash(request["scopeHash"]) else { return result("corrupt") }
        let (status, stored) = readRecord(ref)
        guard status == "ok", let stored = stored else { return result(status) }
        guard stored["scopeHash"] as? String == request["scopeHash"] as? String else { return result("scope-mismatch") }
        return result("ok", ["record": stored])
    }
    if operation == "remove" {
        guard exactKeys(request, ["version", "operation", "reference", "scopeHash", "owner"]), let ref = reference(request["reference"]),
              hash(request["scopeHash"]), uuid(request["owner"]) else { return result("corrupt") }
        let (status, stored) = readRecord(ref)
        guard status == "ok", let stored = stored else { return result(status) }
        guard stored["scopeHash"] as? String == request["scopeHash"] as? String else { return result("scope-mismatch") }
        guard (stored["owner"] as? String)?.lowercased() == (request["owner"] as? String)?.lowercased() else { return result("owner-mismatch") }
        var deletion = query(ref)
        deletion[kSecAttrGeneric as String] = ownershipData(request["scopeHash"] as! String, request["owner"] as! String)
        let deleted = SecItemDelete(deletion as CFDictionary)
        return deleted == errSecSuccess ? result("ok", ["removed": true]) : result(statusName(deleted))
    }
    return result("unsupported")
}

var input = Data()
var malformed = false
while input.count <= maximumBytes {
    do {
        guard let chunk = try FileHandle.standardInput.read(upToCount: min(4096, maximumBytes + 1 - input.count)), !chunk.isEmpty else { break }
        input.append(chunk)
    } catch { malformed = true; break }
}
let response: [String: Any]
if malformed || input.count > maximumBytes {
    response = result("corrupt")
} else if let decoded = try? JSONSerialization.jsonObject(with: input), let request = decoded as? [String: Any] {
    response = perform(request)
} else {
    response = result("corrupt")
}
if let output = try? JSONSerialization.data(withJSONObject: response, options: [.sortedKeys]), output.count <= maximumBytes {
    FileHandle.standardOutput.write(output)
} else {
    FileHandle.standardOutput.write(Data("{\"version\":1,\"status\":\"corrupt\"}".utf8))
}
