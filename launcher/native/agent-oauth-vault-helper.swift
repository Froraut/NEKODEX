// Separate from D01 tunnel credentials. Only this fixed service is accessible.
// One bounded stdin/stdout transaction; noninteractive Security.framework only.
// SecItemUpdate/Delete match the expected revision in kSecAttrGeneric atomically.
import Foundation
import Security

let version = 1, maximumBytes = 32 * 1024
let service = "dev.nekodex.mcp-oauth.v1"
func exact(_ object: [String: Any], _ keys: [String]) -> Bool { Set(object.keys) == Set(keys) }
func matches(_ value: Any?, _ pattern: String) -> Bool {
    guard let text = value as? String else { return false }
    return text.range(of: pattern, options: .regularExpression) != nil
}
func hash(_ value: Any?) -> Bool { matches(value, "^[a-f0-9]{64}$") }
func revision(_ value: Any?) -> Bool { matches(value, "^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$") }
func integer(_ value: Any?, _ expected: Int) -> Bool {
    guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return false }
    return number.doubleValue == Double(expected)
}
func token(_ value: Any?) -> Bool { matches(value, "^[\\x21-\\x7e]{1,8192}$") }
func entry(_ raw: Any?, _ scope: String) -> [String: Any]? {
    guard let item = raw as? [String: Any], exact(item, ["scopeHash", "revision", "record"]),
          item["scopeHash"] as? String == scope, revision(item["revision"]),
          let record = item["record"] as? [String: Any],
          exact(record, record["refreshToken"] == nil ? ["phase", "accessToken", "expiresAt"] : ["phase", "accessToken", "refreshToken", "expiresAt"]),
          let phase = record["phase"] as? String, ["ready", "refresh_pending", "revocation_pending"].contains(phase),
          token(record["accessToken"]), record["refreshToken"] == nil || token(record["refreshToken"]),
          let expires = record["expiresAt"] as? NSNumber, CFGetTypeID(expires) != CFBooleanGetTypeID(),
          expires.doubleValue.isFinite, expires.doubleValue >= 0 else { return nil }
    return item
}
func result(_ status: String, _ extra: [String: Any] = [:]) -> [String: Any] {
    var output = extra; output["version"] = version; output["status"] = status; return output
}
func statusName(_ code: OSStatus) -> String {
    switch code {
    case errSecInteractionNotAllowed, errSecAuthFailed, errSecUserCanceled: return "locked"
    case errSecItemNotFound: return "not-found"
    case errSecDuplicateItem: return "conflict"
    case errSecDecode: return "corrupt"
    case errSecUnimplemented: return "unsupported"
    default: return "unavailable"
    }
}
func query(_ scope: String) -> [String: Any] {
    [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
     kSecAttrAccount as String: scope, kSecUseAuthenticationUI as String: kSecUseAuthenticationUIFail]
}
func perform(_ request: [String: Any]) -> [String: Any] {
    guard integer(request["version"], version), let operation = request["operation"] as? String,
          hash(request["scopeHash"]), let scope = request["scopeHash"] as? String else { return result("invalid-input") }
    let interaction = SecKeychainSetUserInteractionAllowed(false)
    guard interaction == errSecSuccess else { return result(statusName(interaction)) }
    if operation == "read" {
        guard exact(request, ["version", "operation", "scopeHash"]) else { return result("invalid-input") }
        var lookup = query(scope); lookup[kSecReturnData as String] = true; lookup[kSecMatchLimit as String] = kSecMatchLimitOne
        var output: CFTypeRef?
        let status = SecItemCopyMatching(lookup as CFDictionary, &output)
        guard status == errSecSuccess else { return result(statusName(status)) }
        guard let data = output as? Data, data.count <= maximumBytes,
              let decoded = try? JSONSerialization.jsonObject(with: data), let stored = entry(decoded, scope) else { return result("corrupt") }
        return result("ok", ["entry": stored])
    }
    if operation == "compare-and-set" {
        guard exact(request, ["version", "operation", "scopeHash", "expectedRevision", "entry"]),
              let stored = entry(request["entry"], scope), let newRevision = stored["revision"] as? String,
              let data = try? JSONSerialization.data(withJSONObject: stored, options: [.sortedKeys]), data.count <= maximumBytes else { return result("invalid-input") }
        if request["expectedRevision"] is NSNull {
            var insertion = query(scope); insertion[kSecValueData as String] = data
            insertion[kSecAttrGeneric as String] = Data(newRevision.utf8)
            insertion[kSecAttrLabel as String] = "NEKODEX protected MCP OAuth credential"
            // Default application ACL follows the stable signed helper identity.
            let status = SecItemAdd(insertion as CFDictionary, nil)
            return status == errSecSuccess ? result("ok", ["revision": newRevision]) : result(statusName(status))
        }
        guard revision(request["expectedRevision"]), let expected = request["expectedRevision"] as? String else { return result("invalid-input") }
        var update = query(scope); update[kSecAttrGeneric as String] = Data(expected.utf8)
        let attributes: [String: Any] = [kSecValueData as String: data, kSecAttrGeneric as String: Data(newRevision.utf8)]
        let status = SecItemUpdate(update as CFDictionary, attributes as CFDictionary)
        return status == errSecSuccess ? result("ok", ["revision": newRevision]) : result(status == errSecItemNotFound ? "conflict" : statusName(status))
    }
    if operation == "remove" {
        guard exact(request, ["version", "operation", "scopeHash", "expectedRevision"]),
              revision(request["expectedRevision"]), let expected = request["expectedRevision"] as? String else { return result("invalid-input") }
        var deletion = query(scope); deletion[kSecAttrGeneric as String] = Data(expected.utf8)
        let status = SecItemDelete(deletion as CFDictionary)
        return status == errSecSuccess ? result("ok", ["removed": true]) : result(status == errSecItemNotFound ? "conflict" : statusName(status))
    }
    return result("unsupported")
}
var input = Data(), malformed = false
while input.count <= maximumBytes {
    do {
        guard let chunk = try FileHandle.standardInput.read(upToCount: min(4096, maximumBytes + 1 - input.count)), !chunk.isEmpty else { break }
        input.append(chunk)
    } catch { malformed = true; break }
}
let response: [String: Any]
if malformed || input.count > maximumBytes { response = result("invalid-input") }
else if let decoded = try? JSONSerialization.jsonObject(with: input), let request = decoded as? [String: Any] { response = perform(request) }
else { response = result("invalid-input") }
if let output = try? JSONSerialization.data(withJSONObject: response, options: [.sortedKeys]), output.count <= maximumBytes {
    FileHandle.standardOutput.write(output)
} else { FileHandle.standardOutput.write(Data("{\"version\":1,\"status\":\"corrupt\"}".utf8)) }
