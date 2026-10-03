import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// One chat call that must answer with JSON matching `schema`. Used by field reports, Studio narratives and the assessment.
/// OPENAI_API_KEY set (the deployed server) -> OpenAI chat completions; otherwise local Ollama (RESCUE_LLM_URL, default
/// localhost:11434). RESCUE_LLM_OFF=1 -> callers skip the model and use their rules.
public enum LLM {
    static var env: [String: String] { ProcessInfo.processInfo.environment }
    public static var off: Bool { env["RESCUE_LLM_OFF"] == "1" }
    public static var openAI: Bool { !(env["OPENAI_API_KEY"] ?? "").isEmpty }
    public static var model: String {
        openAI ? (env["RESCUE_OPENAI_MODEL"] ?? "gpt-6-luna") : (env["RESCUE_LLM_MODEL"] ?? "qwen3:4b-instruct-2507-q4_K_M")
    }
    public static var ollamaURL: String { env["RESCUE_LLM_URL"] ?? "http://localhost:11434" }
    /// Where the model runs, for /health and logs (never the key).
    public static var endpoint: String { openAI ? "https://api.openai.com/v1" : ollamaURL }
    /// Prefix for FieldReport.parsedBy and notes: "llm-openai" or "llm-local".
    public static var tag: String { openAI ? "llm-openai" : "llm-local" }

    public struct Failure: Error, CustomStringConvertible { public let description: String }

    /// messages: [{role, content}] -> the assistant's content (a JSON string).
    public static func chat(_ messages: [[String: String]], schema: [String: Any], name: String, timeout: Double) async throws -> String {
        var req: URLRequest
        var body: [String: Any]
        if openAI {
            req = URLRequest(url: URL(string: "https://api.openai.com/v1/chat/completions")!, timeoutInterval: timeout)
            req.setValue("Bearer \(env["OPENAI_API_KEY"] ?? "")", forHTTPHeaderField: "Authorization")
            // gpt-6-luna is a reasoning model: no temperature, reasoning off for 1-3 s answers (RESCUE_OPENAI_EFFORT to change)
            body = ["model": model, "messages": messages, "reasoning_effort": env["RESCUE_OPENAI_EFFORT"] ?? "none",
                    "response_format": ["type": "json_schema", "json_schema": ["name": name, "schema": schema, "strict": false]]]
        } else {
            guard let url = URL(string: ollamaURL + "/api/chat") else { throw Failure(description: "bad RESCUE_LLM_URL") }
            req = URLRequest(url: url, timeoutInterval: timeout)
            body = ["model": model, "stream": false, "messages": messages, "format": schema, "options": ["temperature": 0], "keep_alive": "30m"]
        }
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let data: Data, resp: URLResponse
        do { (data, resp) = try await URLSession.shared.data(for: req) } catch {
            throw Failure(description: (error as? URLError)?.code == .timedOut ? "model nie odpowiedział w \(Int(timeout)) s" : "model nieosiągalny (\(endpoint))")
        }
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard code == 200 else { throw Failure(description: "HTTP \(code) z \(endpoint)") }
        let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        let msg = openAI ? ((o["choices"] as? [[String: Any]])?.first?["message"] as? [String: Any]) : (o["message"] as? [String: Any])
        guard let content = msg?["content"] as? String else { throw Failure(description: "brak treści odpowiedzi modelu") }
        return content
    }
}
