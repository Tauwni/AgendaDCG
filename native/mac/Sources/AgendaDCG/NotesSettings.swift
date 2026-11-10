import SwiftUI
import Charts

struct NotesView: View {
    @EnvironmentObject var model: AppModel
    @State private var editing: Grade?
    @State private var subject: String?

    var bySubject: [(subject: String, grades: [Grade])] {
        let all = model.profile?.grades ?? []
        let names = Set(all.map(\.subject))
        return (SUBJECTS.filter(names.contains) + names.subtracting(SUBJECTS).sorted()).map { s in
            (s, all.filter { $0.subject == s }.sorted { $0.date < $1.date })
        }
    }

    var body: some View {
        let groups = bySubject
        let avgs = groups.compactMap { weightedAverage($0.grades) }
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading) {
                        Text("Moyenne générale").foregroundStyle(.secondary)
                        Text(avgs.isEmpty ? "–" : fr(avgs.reduce(0, +) / Double(avgs.count), 2)).font(.system(size: 44, weight: .bold, design: .rounded))
                    }
                    Spacer()
                    Text("Notes privées : toi seul les vois.").font(.caption).foregroundStyle(.secondary)
                }
                if groups.isEmpty {
                    ContentUnavailableView("Aucune note", systemImage: "chart.bar.xaxis", description: Text("Ajoute tes notes pour suivre tes moyennes."))
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 300), spacing: 14)], spacing: 14) {
                    ForEach(groups, id: \.subject) { g in
                        Button { subject = g.subject } label: { SubjectCard(subject: g.subject, grades: g.grades) }.buttonStyle(.plain)
                    }
                }
            }
            .padding(28)
        }
        .toolbar { Button { editing = Grade(id: "", subject: subject ?? "", title: "", date: iso(Date()), category: "controle", value: 10, outOf: 20, coef: 1) } label: { Label("Ajouter une note", systemImage: "plus") } }
        .sheet(item: $editing) { GradeEditor(grade: $0) }
        .sheet(item: Binding(get: { subject.map(IdString.init) }, set: { subject = $0?.id })) { s in SubjectDetail(subject: s.id) }
    }
}

struct GradeChart: View {
    let grades: [Grade]
    var mini = false
    var body: some View {
        let avg = weightedAverage(grades)
        Chart {
            ForEach(Array(grades.enumerated()), id: \.offset) { i, g in
                LineMark(x: .value("n", i), y: .value("Note", g.on20)).foregroundStyle(.red).interpolationMethod(.monotone)
                PointMark(x: .value("n", i), y: .value("Note", g.on20))
                    .foregroundStyle(g.category == "entrainement" ? .gray : .red)
                    .symbolSize(mini ? 20 : 50)
            }
            if let avg { RuleMark(y: .value("Moyenne", avg)).lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 3])).foregroundStyle(.secondary) }
        }
        .chartYScale(domain: 0...20)
        .chartXAxis(.hidden)
        .chartYAxis(mini ? .hidden : .automatic)
    }
}

struct SubjectCard: View {
    let subject: String
    let grades: [Grade]
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(subject).font(.headline).lineLimit(1)
                Spacer()
                Text(weightedAverage(grades).map { fr($0, 2) } ?? "–").font(.title2.bold())
            }
            GradeChart(grades: grades, mini: true).frame(height: 70)
            Text("\(grades.count) note\(grades.count > 1 ? "s" : "")").font(.caption).foregroundStyle(.secondary)
        }
        .padding(14)
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: 12))
        .contentShape(Rectangle())
    }
}

struct SubjectDetail: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) var dismiss
    let subject: String
    @State private var target = 12.0
    @State private var coef = 1.0
    @State private var editing: Grade?

    var body: some View {
        let grades = (model.profile?.grades ?? []).filter { $0.subject == subject }.sorted { $0.date < $1.date }
        let counted = grades.filter { $0.category != "entrainement" }
        let S = counted.reduce(0) { $0 + $1.on20 * $1.coef }, C = counted.reduce(0) { $0 + $1.coef }
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text(subject).font(.title2.bold())
                Spacer()
                Button("Fermer") { dismiss() }.keyboardShortcut(.cancelAction)
            }
            Text("Moyenne : \(weightedAverage(grades).map { fr($0, 2) } ?? "–")").font(.title3)
            GradeChart(grades: grades).frame(height: 180)
            GroupBox("Simulateur") {
                VStack(alignment: .leading, spacing: 8) {
                    HStack { Text("Moyenne visée"); Spacer(); TextField("", value: $target, format: .number).frame(width: 60); Stepper("", value: $target, in: 0...20, step: 0.5).labelsHidden() }
                    HStack { Text("Coefficient du prochain contrôle"); Spacer(); TextField("", value: $coef, format: .number).frame(width: 60); Stepper("", value: $coef, in: 0.5...20, step: 0.5).labelsHidden() }
                    let need = (target * (C + coef) - S) / coef
                    Text(need > 20 ? "Même avec 20/20, ta moyenne monterait à \(fr((S + 20 * coef) / (C + coef), 2))."
                         : need <= 0 ? "C'est déjà gagné : même avec 0/20 tu restes à \(fr(S / (C + coef), 2)) ou plus."
                         : "Il te faut au moins \(fr(need, 2))/20 au prochain contrôle.")
                        .font(.callout.weight(.medium))
                }
                .padding(6)
            }
            List {
                ForEach(grades.reversed()) { g in
                    HStack {
                        VStack(alignment: .leading) {
                            Text(g.title.isEmpty ? CATEGORIES.first { $0.id == g.category }!.label : g.title).font(.body.weight(.medium))
                            Text("\(CATEGORIES.first { $0.id == g.category }?.label ?? "") · \(longDate(g.date))\(g.coef != 1 ? " · coef \(fr(g.coef))" : "")").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text("\(fr(g.value, 2))/\(fr(g.outOf))").font(.headline)
                    }
                    .contentShape(Rectangle())
                    .onTapGesture { editing = g }
                }
            }
            .listStyle(.inset)
            HStack {
                Spacer()
                Button("Ajouter une note") { editing = Grade(id: "", subject: subject, title: "", date: iso(Date()), category: "controle", value: 10, outOf: 20, coef: 1) }
            }
        }
        .padding(24)
        .frame(width: 560, height: 720)
        .sheet(item: $editing) { GradeEditor(grade: $0) }
    }
}

struct GradeEditor: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) var dismiss
    @State var grade: Grade

    var body: some View {
        let isNew = grade.id.isEmpty
        VStack(spacing: 0) {
            Form {
                Picker("Matière", selection: $grade.subject) {
                    if grade.subject.isEmpty { Text("Choisir…").tag("") }
                    ForEach(SUBJECTS, id: \.self) { Text($0).tag($0) }
                }
                TextField("Intitulé", text: $grade.title)
                Picker("Type", selection: $grade.category) { ForEach(CATEGORIES, id: \.id) { Text($0.label).tag($0.id) } }
                DatePicker("Date", selection: Binding(get: { parseISO(grade.date) }, set: { grade.date = iso($0) }), displayedComponents: .date)
                TextField("Note", value: $grade.value, format: .number)
                TextField("Sur", value: $grade.outOf, format: .number)
                TextField("Coefficient", value: $grade.coef, format: .number)
                if grade.category == "entrainement" { Text("Les entraînements ne comptent pas dans la moyenne.").font(.caption).foregroundStyle(.secondary) }
            }
            .formStyle(.grouped)
            HStack {
                if !isNew {
                    Button("Supprimer", role: .destructive) {
                        Task { if await model.saveGrades((model.profile?.grades ?? []).filter { $0.id != grade.id }) { dismiss() } }
                    }
                }
                Spacer()
                Button("Annuler") { dismiss() }.keyboardShortcut(.cancelAction)
                Button(isNew ? "Ajouter" : "Enregistrer") {
                    var all = model.profile?.grades ?? []
                    var g = grade
                    if isNew { g.id = UUID().uuidString.lowercased(); all.append(g) } else { all = all.map { $0.id == g.id ? g : $0 } }
                    Task { if await model.saveGrades(all) { dismiss() } }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(grade.subject.isEmpty)
            }
            .padding()
        }
        .frame(width: 440, height: 480)
    }
}

struct SettingsView: View {
    @EnvironmentObject var model: AppModel
    @EnvironmentObject var updater: Updater
    @State private var usage: [String: Double]?

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
