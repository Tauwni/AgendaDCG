import SwiftUI
import AVFoundation
import PDFKit

/// Lecture à voix haute des PDF avec la voix intégrée du Mac (gratuit, sans limite).
@MainActor
final class Reader: NSObject, ObservableObject, AVSpeechSynthesizerDelegate {
    static let shared = Reader()
    @Published var title: String?
    @Published var playing = false
    @Published var pos = 0
    @Published var rate: Float = UserDefaults.standard.object(forKey: "tts-rate") as? Float ?? 1
    var chunks: [String] = []
    private let synth = AVSpeechSynthesizer()
    private var token = 0
    private var key = ""
    var line: String { chunks[safe: pos] ?? "" }
    private func save() { if !key.isEmpty { UserDefaults.standard.set(pos, forKey: "tts-pos:" + key) } }

    override init() { super.init(); synth.delegate = self }

    func read(url: URL, title: String, key: String = "") throws {
        guard let doc = PDFDocument(url: url) else { throw err("PDF illisible") }
        var text = doc.string ?? ""
        text = text.replacingOccurrences(of: #"(\w)-\n(\w)"#, with: "$1$2", options: .regularExpression)
            .replacingOccurrences(of: #"[•▪●◦■□►➢✓]"#, with: " ", options: .regularExpression)
            .replacingOccurrences(of: #"([^.!?:;\n])\n(?=[a-zà-ÿ])"#, with: "$1 ", options: .regularExpression)
        chunks = Reader.split(text)
        guard chunks.joined().count >= 80 else { throw err("Ce PDF est une image (scan) : pas de texte à lire") }
        self.title = title; self.key = key
        let saved = UserDefaults.standard.integer(forKey: "tts-pos:" + key)
        pos = (!key.isEmpty && saved > 0 && saved < chunks.count - 1) ? saved : 0 // reprise là où on s'était arrêté
        play()
    }

    static func split(_ text: String) -> [String] {
        var out: [String] = []
        text.enumerateSubstrings(in: text.startIndex..., options: .bySentences) { s, _, _, _ in
            guard var t = s?.trimmingCharacters(in: .whitespacesAndNewlines), t.contains(where: { $0.isLetter || $0.isNumber }) else { return }
            t = t.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            while t.count > 300 { let i = t.index(t.startIndex, offsetBy: 300); let cut = t[..<i].lastIndex(of: " ") ?? i; out.append(String(t[..<cut])); t = String(t[cut...]).trimmingCharacters(in: .whitespaces) }
            out.append(t)
        }
        return out
    }

    static var voice: AVSpeechSynthesisVoice? {
        AVSpeechSynthesisVoice.speechVoices().filter { $0.language.hasPrefix("fr") }
            .max { score($0) < score($1) }
    }
    static func score(_ v: AVSpeechSynthesisVoice) -> Int {
        (v.quality == .premium ? 4 : v.quality == .enhanced ? 3 : 0) + (v.language == "fr-FR" ? 1 : 0)
    }

    private func speakCurrent() {
        guard pos < chunks.count else { pos = 0; stop(); return }
        save()
        let u = AVSpeechUtterance(string: chunks[pos])
        u.voice = Reader.voice
        u.rate = AVSpeechUtteranceDefaultSpeechRate * (0.85 + (rate - 1) * 0.5)
        synth.speak(u)
    }

    func play() { token += 1; synth.stopSpeaking(at: .immediate); playing = true; speakCurrent() }
    func pause() { token += 1; playing = false; synth.stopSpeaking(at: .immediate) }
    func stop() { save(); token += 1; playing = false; synth.stopSpeaking(at: .immediate); title = nil }
    func jump(_ d: Int) { pos = max(0, min(chunks.count - 1, pos + d)); if playing { play() } }
    func nextRate() {
        let steps: [Float] = [0.8, 1, 1.25, 1.5, 1.75, 2]
        rate = steps[((steps.firstIndex(of: rate) ?? 1) + 1) % steps.count]
        UserDefaults.standard.set(rate, forKey: "tts-rate")
        if playing { play() }
    }

    nonisolated func speechSynthesizer(_ s: AVSpeechSynthesizer, didFinish u: AVSpeechUtterance) {
        Task { @MainActor in
            guard self.playing, u.speechString == self.chunks[safe: self.pos] else { return }
            self.pos += 1; self.speakCurrent()
        }
    }

    private func err(_ m: String) -> NSError { NSError(domain: "Reader", code: 1, userInfo: [NSLocalizedDescriptionKey: m]) }
}

extension Array { subscript(safe i: Int) -> Element? { indices.contains(i) ? self[i] : nil } }

struct ReaderBar: View {
    @ObservedObject var r = Reader.shared
    var body: some View {
        if let title = r.title {
            VStack(spacing: 4) {
            HStack(spacing: 10) {
                Text("🎧")
                Text(title).lineLimit(1).frame(maxWidth: 260, alignment: .leading)
                Text(r.chunks.isEmpty ? "" : "\(100 * r.pos / r.chunks.count) %").font(.caption).foregroundStyle(.secondary)
                Button { r.jump(-3) } label: { Image(systemName: "gobackward") }.help("Reculer")
                Button { r.playing ? r.pause() : r.play() } label: { Image(systemName: r.playing ? "pause.fill" : "play.fill") }.keyboardShortcut(.space, modifiers: [.option])
                Button { r.jump(3) } label: { Image(systemName: "goforward") }.help("Avancer")
                Button("×\(r.rate.formatted())") { r.nextRate() }.help("Vitesse")
                Button { r.stop() } label: { Image(systemName: "xmark") }.help("Arrêter")
            }
            Text(r.line).font(.caption).foregroundStyle(.secondary).lineLimit(2).frame(maxWidth: 520)
            }
            .buttonStyle(.borderless)
            .padding(.horizontal, 14).padding(.vertical, 8)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18))
            .shadow(radius: 8)
            .padding(.bottom, 16)
        }
    }
}
