import SwiftUI

/// Mise à jour automatique depuis les releases GitHub :
/// télécharge Agenda-DCG-Mac.zip en arrière-plan, puis remplace l'app au redémarrage (ou en quittant).
@MainActor
final class Updater: ObservableObject {
    static let shared = Updater()
    static let currentVersion = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
    private let repo = "Tauwni/AgendaDCG"

    @Published var ready: URL?            // nouvelle app décompressée, prête à installer
    @Published var status = "À jour"
    private var readyVersion = ""

    func loop() async {
        try? await Task.sleep(for: .seconds(5))
        while true {
            await check(manual: false)
            try? await Task.sleep(for: .seconds(6 * 3600))
        }
    }

    static func newer(_ a: String, than b: String) -> Bool {
        let x = a.split(separator: ".").map { Int($0) ?? 0 }, y = b.split(separator: ".").map { Int($0) ?? 0 }
        for i in 0..<max(x.count, y.count) {
            let p = i < x.count ? x[i] : 0, q = i < y.count ? y[i] : 0
            if p != q { return p > q }
        }
        return false
    }

    func check(manual: Bool) async {
        guard Bundle.main.bundleURL.pathExtension == "app" else { status = "Désactivée (version de développement)"; return }
        if ready != nil { status = "Version \(readyVersion) prête"; return }
        struct Asset: Decodable { var name: String; var browser_download_url: URL }
        struct Release: Decodable { var tag_name: String; var assets: [Asset] }
        do {
            status = "Recherche…"
            var req = URLRequest(url: URL(string: "https://api.github.com/repos/\(repo)/releases/latest")!)
            req.setValue("application/vnd.github+json", forHTTPHeaderField: "accept")
            let (data, _) = try await URLSession.shared.data(for: req)
            let rel = try JSONDecoder().decode(Release.self, from: data)
            let version = rel.tag_name.trimmingCharacters(in: CharacterSet(charactersIn: "v"))
            guard Self.newer(version, than: Self.currentVersion),
                  let asset = rel.assets.first(where: { $0.name == "Agenda-DCG-Mac.zip" }) else {
                status = "À jour (\(Self.currentVersion))"
                if manual { alert("Agenda DCG est à jour", "Tu as la dernière version (\(Self.currentVersion)).") }
                return
            }
            status = "Téléchargement de la version \(version)…"
            let (zip, _) = try await URLSession.shared.download(from: asset.browser_download_url)
            let dir = FileManager.default.temporaryDirectory.appending(path: "AgendaDCG-update-\(version)")
            try? FileManager.default.removeItem(at: dir)
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let p = Process()
            p.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
            p.arguments = ["-x", "-k", zip.path, dir.path]
            try p.run()
            p.waitUntilExit()
            guard p.terminationStatus == 0,
                  let app = try FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil).first(where: { $0.pathExtension == "app" })
            else { throw URLError(.cannotDecodeContentData) }
            readyVersion = version
            ready = app
            status = "Version \(version) prête : redémarre pour l'installer"
            if manual { installAndRelaunch() }
        } catch {
            status = "Impossible de vérifier (hors ligne ?)"
            if manual { alert("Mise à jour impossible", "Vérifie ta connexion internet et réessaie.") }
        }
    }

    private func alert(_ title: String, _ text: String) {
        let a = NSAlert()
        a.messageText = title
        a.informativeText = text
        a.runModal()
    }

    /// Script lancé après la fermeture : remplace le bundle puis (optionnellement) relance.
    private func launchSwap(relaunch: Bool) {
        guard let ready else { return }
        let target = Bundle.main.bundleURL.path
        let pid = ProcessInfo.processInfo.processIdentifier
        let script = """
        while kill -0 \(pid) 2>/dev/null; do sleep 0.2; done
        rm -rf "\(target).old" && mv "\(target)" "\(target).old" && mv "\(ready.path)" "\(target)" && rm -rf "\(target).old" || { [ -d "\(target).old" ] && [ ! -d "\(target)" ] && mv "\(target).old" "\(target)"; }
        xattr -dr com.apple.quarantine "\(target)" 2>/dev/null
        \(relaunch ? "open \"\(target)\"" : "")
        """
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/sh")
        p.arguments = ["-c", script]
        try? p.run()
        self.ready = nil
    }

    func installAndRelaunch() {
        launchSwap(relaunch: true)
        NSApp.terminate(nil)
    }

    nonisolated func installOnQuit() {
        MainActor.assumeIsolated { if ready != nil { launchSwap(relaunch: false) } }
    }
}
