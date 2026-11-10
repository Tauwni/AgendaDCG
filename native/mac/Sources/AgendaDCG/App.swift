import SwiftUI

@main
struct AgendaDCGApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var delegate
    @StateObject private var model = AppModel()
    @StateObject private var updater = Updater.shared

    var body: some Scene {
        WindowGroup("Agenda DCG", id: "main") {
            RootView()
                .environmentObject(model)
                .environmentObject(updater)
                .frame(minWidth: 820, minHeight: 560)
                .tint(.red)
                .task { await model.start() }
                .task { await updater.loop() }
        }
        .defaultSize(width: 1180, height: 780)
        .commands {
            CommandGroup(after: .appInfo) {
                Button("Rechercher les mises à jour…") { Task { await updater.check(manual: true) } }
            }
            CommandGroup(replacing: .newItem) {}
            CommandMenu("Agenda") {
                Button("Actualiser") { Task { await model.refresh() } }.keyboardShortcut("r")
            }
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationWillTerminate(_ notification: Notification) { Updater.shared.installOnQuit() }
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
    }
}

enum Tab: String, CaseIterable, Identifiable {
    case today, agenda, cours, notes, reviser, settings
    var id: String { rawValue }
    var label: String { ["today": "Aujourd'hui", "agenda": "Agenda", "cours": "Cours", "notes": "Notes", "reviser": "Réviser", "settings": "Réglages"][rawValue]! }
    var icon: String { ["today": "house", "agenda": "calendar", "cours": "books.vertical", "notes": "chart.bar.xaxis", "reviser": "scope", "settings": "gearshape"][rawValue]! }
}

struct RootView: View {
    @EnvironmentObject var model: AppModel
    @EnvironmentObject var updater: Updater
    @State private var tab: Tab = .today

    var body: some View {
        Group {
            switch model.phase {
            case .loading: ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            case .login: LoginView()
            case .ready:
                NavigationSplitView {
                    List(Tab.allCases, selection: Binding(get: { tab }, set: { if let t = $0 { tab = t } })) { t in
                        Label(t.label, systemImage: t.icon).tag(t)
                    }
                    .navigationSplitViewColumnWidth(min: 170, ideal: 190, max: 240)
                    .safeAreaInset(edge: .bottom) { SidebarFooter() }
                } detail: {
                    Group {
                        switch tab {
                        case .today: TodayView()
                        case .agenda: AgendaView()
                        case .cours: CoursView()
                        case .notes: NotesView()
                        case .reviser: ReviserView()
                        case .settings: SettingsView()
                        }
                    }
                    .navigationTitle(tab.label)
                }
            }
        }
        .overlay(alignment: .bottom) {
            if let t = model.toast {
                Text(t).padding(.horizontal, 16).padding(.vertical, 10)
                    .background(.regularMaterial, in: Capsule())
                    .padding(.bottom, 24)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.spring(duration: 0.35), value: model.toast)
    }
}

struct SidebarFooter: View {
    @EnvironmentObject var model: AppModel
    @EnvironmentObject var updater: Updater
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if updater.ready != nil {
                Button { updater.installAndRelaunch() } label: {
                    Label("Mise à jour prête · Redémarrer", systemImage: "arrow.down.circle.fill")
                }
                .buttonStyle(.borderedProminent).controlSize(.small)
            }
            if model.offline {
                Label("Hors ligne", systemImage: "wifi.slash").font(.caption).foregroundStyle(.secondary)
            }
            Label(model.name, systemImage: "person.crop.circle").font(.callout).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
    }
}

struct LoginView: View {
    @EnvironmentObject var model: AppModel
    @State private var name = UserDefaults.standard.string(forKey: "name") ?? ""
    @State private var password = ""
    @State private var pin = ""
    @State private var needPass = true
    @State private var step = 0 // 0 = prénom, 1 = code
    @State private var exists = true
    @State private var error = ""
    @State private var busy = false

    var body: some View {
        VStack(spacing: 18) {
            Image(nsImage: NSApp.applicationIconImage).resizable().frame(width: 96, height: 96)
            Text("Agenda DCG").font(.largeTitle.bold())
            Text(step == 0 ? "Connecte-toi avec ton prénom." : exists ? "Entre ton code perso à 6 chiffres." : "Crée ton code perso à 6 chiffres.")
                .foregroundStyle(.secondary)
            VStack(spacing: 10) {
                TextField("Prénom", text: $name).disabled(step == 1)
                if needPass && step == 0 { SecureField("Mot de passe de la classe", text: $password) }
                if step == 1 { SecureField("Code perso (6 chiffres)", text: $pin) }
            }
            .textFieldStyle(.roundedBorder)
            .frame(width: 280)
            .onSubmit(next)
            if !error.isEmpty { Text(error).foregroundStyle(.red).font(.callout) }
            HStack {
                if step == 1 { Button("Retour") { step = 0; pin = ""; error = "" } }
                Button(step == 0 ? "Continuer" : exists ? "Se connecter" : "Créer mon compte", action: next)
                    .keyboardShortcut(.defaultAction)
                    .disabled(busy)
            }
            .controlSize(.large)
            if model.offline { Label("Pas de connexion internet", systemImage: "wifi.slash").foregroundStyle(.secondary) }
        }
        .padding(40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task { needPass = (try? await API.raw("me").1) != 200 }
    }

    func next() {
        error = ""
        busy = true
        Task {
            defer { busy = false }
            do {
                if step == 0 {
                    struct Check: Decodable { var exists: Bool }
                    exists = try await API.call("profile/check", method: "POST", body: ["name": name], as: Check.self).exists
                    step = 1
                } else {
                    let p: Profile = try await API.call("profile/login", method: "POST", body: ["name": name, "pin": pin, "password": password, "create": !exists])
                    await model.didLogin(p)
                }
            } catch { self.error = error.localizedDescription }
        }
    }
}
