import SwiftUI
import WebKit

/// Onglet Réviser : Objectif DCG, l'appli de révision d'un camarade de classe.
struct ReviserView: View {
    @EnvironmentObject var model: AppModel
    private let covered = ["UE2", "UE4", "UE6"]

    var body: some View {
        let today = iso(Date())
        let next = model.events.filter { $0.isDeadline && $0.date >= today && !model.isDone($0) }.sorted { $0.sortKey < $1.sortKey }.prefix(4)
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                HStack(alignment: .top, spacing: 18) {
                    AsyncImage(url: URL(string: "https://objectif-dcg.netlify.app/icon-192.png")) { img in img.resizable() } placeholder: { Color.secondary.opacity(0.15) }
                        .frame(width: 72, height: 72)
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Objectif DCG").font(.title2.bold())
                        Text("Plus de 3 500 flash cards, des quiz, une pile du jour et une ligue pour réviser le droit fiscal (UE4), le droit des sociétés (UE2) et la finance (UE6).")
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                        HStack {
                            Button { ReviseWindow.show() } label: { Label("Ouvrir Objectif DCG", systemImage: "scope") }
                                .buttonStyle(.borderedProminent).controlSize(.large)
                            Button("Ouvrir dans le navigateur") { NSWorkspace.shared.open(REVISE_URL) }.controlSize(.large)
                        }
                        .padding(.top, 4)
                    }
                }
                .padding(20)
                .background(.background.secondary, in: RoundedRectangle(cornerRadius: 14))

                if !next.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("À réviser en priorité").font(.title2.bold())
                        ForEach(Array(next)) { EventRow(event: $0, showDate: true) }
                        Text(next.contains { covered.contains(($0.subject ?? "").components(separatedBy: " · ").first ?? "") }
                             ? "UE2, UE4 et UE6 sont dans Objectif DCG : lance une révision express avant le contrôle."
                             : "Ces matières ne sont pas encore dans Objectif DCG : appuie-toi sur les fiches de l'onglet Cours.")
                            .font(.callout).foregroundStyle(.secondary)
                    }
                }
                Text("Objectif DCG est une appli créée par un camarade de la classe. Ta progression y est gardée sur son site, avec ton propre compte.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            .padding(28)
            .frame(maxWidth: 760, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
    }
}

/// Fenêtre intégrée qui garde la connexion à Objectif DCG d'une fois sur l'autre.
enum ReviseWindow {
    @MainActor static var window: NSWindow?

    @MainActor static func show() {
        if let window { window.makeKeyAndOrderFront(nil); return }
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        let web = WKWebView(frame: .zero, configuration: config)
        web.allowsBackForwardNavigationGestures = true
        web.load(URLRequest(url: REVISE_URL))
        let win = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1100, height: 820), styleMask: [.titled, .closable, .resizable, .miniaturizable], backing: .buffered, defer: false)
        win.title = "Objectif DCG"
        win.contentView = web
        win.isReleasedWhenClosed = false
        win.setFrameAutosaveName("ObjectifDCG")
        win.center()
        win.makeKeyAndOrderFront(nil)
        NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: win, queue: .main) { _ in
            MainActor.assumeIsolated { window = nil }
        }
        window = win
    }
}
