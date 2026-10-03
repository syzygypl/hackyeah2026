import Foundation

/// Hardening for rescue-server on a LAN (--host) and on the public deploy (RESCUE_PUBLIC=1, writes only).
/// Loopback-only by default. Any other --host REQUIRES a PIN (given with --pin or auto-generated, 6 digits).
/// Loopback clients never need the PIN. LAN clients send it as header `X-Rescue-Pin` or JSON field `pin`.
public struct ServerGuard: Sendable {
    public let host: String
    public let port: UInt16?
    public let pin: String?            // nil = loopback-only server
    public let pinGenerated: Bool
    /// Public deploy: a second, narrower key for rescuers' phones (reports and clues only); nil = the PIN does everything.
    public let fieldPin: String? = ProcessInfo.processInfo.environment["RESCUE_FIELD_PIN"].flatMap { $0.isEmpty ? nil : $0 }

    public init(args: [String], defaultPort: UInt16) {
        func val(_ flag: String) -> String? {
            args.firstIndex(of: flag).flatMap { $0 + 1 < args.count ? args[$0 + 1] : nil }
        }
        host = val("--host") ?? "127.0.0.1"
        let flagged = Set(["--host", "--pin"].compactMap { f in args.firstIndex(of: f).map { $0 + 1 } })
        let positional = args.enumerated().filter { i, a in !a.hasPrefix("--") && !flagged.contains(i) }.map(\.element)
        port = positional.compactMap { UInt16($0) }.first ?? defaultPort
        // RESCUE_GUARD_STRICT=1 with an explicit --pin keeps the PIN on a loopback bind (one-machine demo of the guard)
        let strictPin = ProcessInfo.processInfo.environment["RESCUE_GUARD_STRICT"] == "1" && !(val("--pin") ?? "").isEmpty
        if ServerGuard.isLoopbackHost(host) && !strictPin {
            pin = nil; pinGenerated = false
        } else if let p = val("--pin") ?? ProcessInfo.processInfo.environment["RESCUE_PIN"], !p.isEmpty {
            pin = p; pinGenerated = false
        } else {
            var g = SystemRandomNumberGenerator()
            pin = String(format: "%06d", Int.random(in: 0...999_999, using: &g)); pinGenerated = true
        }
    }

    public var lan: Bool { pin != nil }

    public static func isLoopbackHost(_ h: String) -> Bool { h == "127.0.0.1" || h == "localhost" || h == "::1" }
    /// RESCUE_GUARD_STRICT=1 treats loopback like LAN (for testing the PIN rules on one machine).
    public static func isLoopbackPeer(_ ip: String) -> Bool {
        if ProcessInfo.processInfo.environment["RESCUE_GUARD_STRICT"] == "1" { return false }
        return ip == "127.0.0.1" || ip == "::1" || ip.hasPrefix("127.") || ip.hasPrefix("::ffff:127.")
    }

    /// Loopback regardless of RESCUE_GUARD_STRICT (used for /metrics scraping on the laptop itself).
    public static func isRealLoopbackPeer(_ ip: String) -> Bool {
        ip == "127.0.0.1" || ip == "::1" || ip.hasPrefix("127.") || ip.hasPrefix("::ffff:127.")
    }

    /// Constant-time string compare (no early exit on first differing byte).
    public static func constantTimeEqual(_ a: String, _ b: String) -> Bool {
        let x = Array(a.utf8), y = Array(b.utf8)
        var diff = UInt8(x.count == y.count ? 0 : 1)
        for i in 0..<max(x.count, y.count) {
            diff |= (i < x.count ? x[i] : 0) ^ (i < y.count ? y[i] : 0)
        }
        return diff == 0
    }

    /// The key alone, no loopback exemption (public deploy: the platform proxy may connect from loopback).
    /// fieldScope: the request is one a rescuer may make, so the field key is accepted too.
    public func keyMatches(headers: [String: String], body: Data, fieldScope: Bool = false) -> Bool {
        guard let pin else { return false }
        var given = headers["x-rescue-pin"] ?? ""
        if given.isEmpty, let o = try? JSONSerialization.jsonObject(with: body) as? [String: Any] {
            given = (o["pin"] as? String) ?? (o["pin"] as? Int).map(String.init) ?? ""
        }
        if ServerGuard.constantTimeEqual(given, pin) { return true }
        if fieldScope, let fieldPin { return ServerGuard.constantTimeEqual(given, fieldPin) }
        return false
    }

    /// true if the request may proceed. Loopback always passes.
    public func authorized(peer: String, headers: [String: String], body: Data) -> Bool {
        guard let pin else { return true }
        if ServerGuard.isLoopbackPeer(peer) { return true }
        var given = headers["x-rescue-pin"] ?? ""
        if given.isEmpty, let o = try? JSONSerialization.jsonObject(with: body) as? [String: Any] {
            given = (o["pin"] as? String) ?? (o["pin"] as? Int).map(String.init) ?? ""
        }
        return ServerGuard.constantTimeEqual(given, pin)
    }

    public static func logReject(_ status: Int, peer: String, method: String, path: String) {
        let t = ISO8601DateFormatter().string(from: Date())
        FileHandle.standardError.write(Data("[guard] \(t) \(status) \(peer) \(method) \(path)\n".utf8))
    }

    public func banner(name: String, lanAddresses: [String]) -> [String] {
        guard let pin else { return [] }
        var out = (host == "0.0.0.0" ? lanAddresses : [host]).map { "  LAN: http://\($0):\(port ?? 0)/" }
        out.append("  PIN: \(pin)\(pinGenerated ? " (generated; pass --pin NNNN to choose)" : "")  - LAN clients send header X-Rescue-Pin or JSON \"pin\"; loopback needs none")
        out.append("  WARNING: \(name) is exposed beyond this machine. Run it only on our own phone hotspot, never on the hall Wi-Fi.")
        return out
    }
}

/// Sliding-window rate limit per client IP.
public final class RateLimiter: @unchecked Sendable {
    let lock = NSLock()
    var hits: [String: [Date]] = [:]
    let max: Int, window: TimeInterval
    public init(max: Int, perSeconds: TimeInterval) { self.max = max; window = perSeconds }
    public func allow(_ ip: String) -> Bool {
        lock.lock(); defer { lock.unlock() }
        let now = Date()
        var h = (hits[ip] ?? []).filter { now.timeIntervalSince($0) < window }
        guard h.count < max else { hits[ip] = h; return false }
        h.append(now); hits[ip] = h
        return true
    }
}

/// IPv4 addresses of this machine (for printing LAN URLs).
public func localIPv4Addresses() -> [String] {
    var out: [String] = []
    var ifa: UnsafeMutablePointer<ifaddrs>?
    guard getifaddrs(&ifa) == 0, let first = ifa else { return out }
    defer { freeifaddrs(ifa) }
    for p in sequence(first: first, next: { $0.pointee.ifa_next }) {
        guard let sa = p.pointee.ifa_addr, Int32(sa.pointee.sa_family) == AF_INET else { continue }
        var b = [CChar](repeating: 0, count: Int(NI_MAXHOST))
        #if os(Linux)
        let saLen = socklen_t(MemoryLayout<sockaddr_in>.size)
        #else
        let saLen = socklen_t(sa.pointee.sa_len)
        #endif
        if getnameinfo(sa, saLen, &b, socklen_t(b.count), nil, 0, NI_NUMERICHOST) == 0 {
            let a = String(cString: b)
            if !a.hasPrefix("127.") { out.append(a) }
        }
    }
    return out
}
