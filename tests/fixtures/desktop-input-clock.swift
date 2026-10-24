import AppKit

@main struct InputClockHarness {
    static func synthetic(_ event: (CGEventType) -> TimeInterval, pauseFirst: Bool = false) throws -> (InputTimeBounds, Int, Bool) {
        var now: TimeInterval = 100; var queries = 0; var keyDown = false
        let sample = try sampleLastInputTime(clock: { now }, age: { type in
            queries += 1; keyDown = keyDown || type == .keyDown
            now += pauseFirst && queries == 1 ? 0.02993 : 0.00002
            return now - event(type)
        })
        return (sample, queries, keyDown)
    }
    static func failure(_ mode: String) -> [String: Any] {
        var now: TimeInterval = 100; var queries = 0; var clockReads = 0
        do {
            _ = try sampleLastInputTime(types: [.keyDown], clock: {
                clockReads += 1
                if mode == "nonfinite-clock" { return .infinity }
                if mode == "backwards" { return clockReads.isMultiple(of: 2) ? 99 : 100 }
                return now
            }, age: { _ in
                queries += 1
                if mode == "wide" { now += 0.02993 }
                if mode == "negative-age" { return -1 }
                if mode == "nonfinite-age" { return .infinity }
                return now - 90
            })
            return ["accepted": true, "queries": queries]
        } catch let error as PortError { return ["accepted": false, "reason": error.code, "queries": queries] }
        catch { return ["accepted": false, "reason": "unexpected", "queries": queries] }
    }
    static func main() throws {
        let baseline = try synthetic({ _ in 90 }, pauseFirst: true)
        let unchanged = try synthetic { _ in 90 }
        let within = try synthetic { $0 == .keyDown ? 90.004 : 90 }
        let repeatKey = try synthetic { $0 == .keyDown ? 90.006 : 90 }
        let boundary = try synthetic { $0 == .keyDown ? 90.005 : 90 }
        let threshold = baseline.0.lower + 0.005
        let oldBaseline = 100 - ((100 + 0.02993) - 90)
        let failures = Dictionary(uniqueKeysWithValues: ["wide", "negative-age", "nonfinite-age", "nonfinite-clock", "backwards"].map { ($0, failure($0)) })
        // Passive CG age reads only: no helper, capture, window enumeration or input.
        var passive: [String: Any]
        do { let value = try sampleLastInputTime(); passive = ["sampled": true, "lower": value.lower, "upper": value.upper, "uncertainty": value.upper - value.lower] }
        catch let error as PortError { passive = ["sampled": false, "reason": error.code] }
        let result: [String: Any] = [
            "oldFalseAdvance": 90 - oldBaseline,
            "baseline": ["lower": baseline.0.lower, "upper": baseline.0.upper, "queries": baseline.1],
            "unchangedAllowed": unchanged.0.upper <= threshold,
            "within4msAllowed": within.0.upper <= threshold,
            "repeat6msRejected": repeatKey.0.upper > threshold,
            "uncertain5msRejected": boundary.0.upper > threshold,
            "keyDownQueried": baseline.2 && repeatKey.2,
            "eventTypes": physicalInputEventTypes.map { $0.rawValue },
            "failures": failures, "passive": passive,
        ]
        print(String(data: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), encoding: .utf8)!)
    }
}
