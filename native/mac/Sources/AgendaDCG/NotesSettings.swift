import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var model: AppModel
    @EnvironmentObject var updater: Updater
    @State private var usage: [String: Double]?
    @State private var levels = false

    var body: some View {
        let prefs = model.profile?.prefs ?? Prefs()
        Form {
            Section("Compte") {
                LabeledContent("Connecté en tant que", value: model.name)
                Button("Se déconnecter", role: .destructive) { Task { await model.logout() } }
            }
            Section {
                toggle("À chaque nouvelle évaluation", prefs.onNew) { $0.onNew = $1 }
                toggle("Résumé chaque matin (7 h)", prefs.daily) { $0.daily = $1 }
                toggle("Résumé de la semaine (dimanche 18 h)", prefs.weekly) { $0.weekly = $1 }
                ForEach([1, 2, 7], id: \.self) { d in
                    toggle(d == 1 ? "Rappel la veille (19 h)" : "Rappel \(d) jours avant", prefs.before.contains(d)) { p, on in
                        p.before = on ? Array(Set(p.before + [d])).sorted() : p.before.filter { $0 != d }
                    }
                }
            } header: { Text("Notifications") } footer: { Text("Les rappels s'affichent sur ce Mac, même quand l'agenda est fermé.") }
            Section("Révisions") {
                Button(model.hasLevels ? "Modifier mon niveau par matière" : "Personnaliser mes révisions (1 min)") { levels = true }
            }
            Section("Devoirs passés") {
                if model.pastHomework.isEmpty { Text("Les sujets joints aux devoirs apparaîtront ici une fois la date passée.").foregroundStyle(.secondary) }
                ForEach(model.pastHomework) { e in
                    VStack(alignment: .leading, spacing: 4) {
                        Text("\(e.title) · \(longDate(e.date))").font(.callout.weight(.semibold))
                        ForEach(e.attachments ?? [], id: \.key) { f in
                            Button { Task { do { PdfWindow.show(url: try await model.download(f), title: f.name) } catch { model.show(error.localizedDescription) } } } label: { Label(f.name, systemImage: "doc.richtext") }.buttonStyle(.link)
                        }
                    }
                }
            }
            Section("Application") {
                LabeledContent("Version", value: Updater.currentVersion)
                LabeledContent("Mise à jour", value: updater.status)
                Button("Rechercher les mises à jour") { Task { await updater.check(manual: true) } }
                Link("Ouvrir l'agenda dans le navigateur", destination: SITE)
            }
        }
        .formStyle(.grouped)
        .sheet(isPresented: $levels) { LevelsSurvey() }
        .frame(maxWidth: 640)
        .frame(maxWidth: .infinity)
    }

    func toggle(_ label: String, _ value: Bool, _ apply: @escaping (inout Prefs, Bool) -> Void) -> some View {
        Toggle(label, isOn: Binding(get: { value }, set: { on in
            var p = model.profile?.prefs ?? Prefs()
            apply(&p, on)
            Task { await model.savePrefs(p) }
        }))
    }
}
