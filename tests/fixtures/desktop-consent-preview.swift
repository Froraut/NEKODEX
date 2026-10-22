// Compile with desktop-provider.swift and NEKODEX_DESKTOP_HELPER_HARNESS.
// No DesktopPort, stdio request loop, permission request, capture, or input is started.
import AppKit
import Foundation

@MainActor func consentPreviewMainThread() -> Bool { Thread.isMainThread }

@main struct ConsentPreview {
    @MainActor static func main() {
        runDesktopConsentApplication { await showPreview() }
    }

    @MainActor static func showPreview() async {
        // Match production after its detached blocking stdin read resumes on MainActor.
        _ = await Task.detached { true }.value
        let consent = DesktopEnableConsent(previewNote: "INERT DEVELOPMENT PREVIEW\nAllow only records the button choice. This process cannot enable a desktop provider.")
        consent.window.title = "NEKODEX consent preview — no desktop access"
        Task { @MainActor in
            // One next-turn snapshot, not a presentation retry or an input action.
            await Task.yield()
            let frame = consent.window.frame
            let state: [String: Any] = ["pid": getpid(), "applicationRunning": NSApplication.shared.isRunning,
                "windowNumber": consent.window.windowNumber, "isVisible": consent.window.isVisible,
                "occlusionVisible": consent.window.occlusionState.contains(.visible),
                "frame": ["x": frame.minX, "y": frame.minY, "width": frame.width, "height": frame.height]]
            let destination = Bundle.main.bundleURL.deletingLastPathComponent().appendingPathComponent("consent-preview-window.json")
            try! JSONSerialization.data(withJSONObject: state, options: [.sortedKeys]).write(to: destination, options: .atomic)
        }
        let allowed = await consent.present()
        let result: [String: Any] = ["preview": true, "allowedChoice": allowed, "pid": getpid(),
            "observedAt": ISO8601DateFormatter().string(from: Date()),
            "providerCreated": false, "desktopEnabled": false, "mainThread": consentPreviewMainThread(),
            "applicationRunning": NSApplication.shared.isRunning]
        let bytes = try! JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
        let receipt = Bundle.main.bundleURL.deletingLastPathComponent().appendingPathComponent("consent-preview-last-result.json")
        try! bytes.write(to: receipt, options: .atomic)
        print(String(data: bytes, encoding: .utf8)!)
    }
}
